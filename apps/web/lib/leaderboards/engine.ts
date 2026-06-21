/**
 * lib/leaderboards/engine.ts
 *
 * Leaderboard utility functions.
 *
 * Leaderboards are materialised at write time:
 *  - When XP is awarded, leaderboard_snapshots is updated via upsert.
 *  - Read paths query the snapshot table (never calculate live from xp_ledger).
 *
 * Table schema (migration 011):
 *   leaderboard_snapshots(user_id, track, scope, city, season_id, xp_value, updated_at)
 *   UNIQUE(user_id, track, scope, city, season_id) — NULLs handled via IS NOT DISTINCT FROM
 *
 * Scopes: global | national | city | guild | season
 * Tracks: main | social | creator | competitor | generosity | knowledge | explorer
 */

import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaderboardScope = "global" | "national" | "city" | "guild" | "season";
export type LeaderboardTrack =
  | "main"
  | "social"
  | "creator"
  | "competitor"
  | "generosity"
  | "knowledge"
  | "explorer"
  | "gaming";

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  rank_name: string;
  xp_value: number;
  city: string | null;
  /** True for Hall of Fame users (Prestige 10) — always pinned to global top 100. */
  is_hall_of_fame?: boolean;
  /** Custom crest URL or emoji set by Hall of Fame users (PRD §9). */
  custom_crest?: string | null;
}

export interface LeaderboardCursor {
  xpValue: number;
  userId: string;
  /** Global rank of the last entry on the previous page. Used to compute correct ranks on subsequent pages. */
  rank?: number;
}

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  /** Count of ranked (non-HoF) users. Consistent across all pages. */
  total: number;
  /** Count of Hall of Fame users injected on page 1. Use this to display total including HoF. */
  hofCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  /** Opaque cursor for the next page. Null if there are no more results. */
  nextCursor: LeaderboardCursor | null;
}

// ---------------------------------------------------------------------------
// getUserRank
// ---------------------------------------------------------------------------

/**
 * Returns the user's current rank position on a given leaderboard.
 * Uses the materialised snapshot, so the read is fast.
 *
 * @param userId - UUID of the user.
 * @param track  - Which XP track to query.
 * @param scope  - Leaderboard scope (global, city, guild, season).
 * @param db     - Active database adapter.
 * @returns The 1-based rank number, or null if the user has no snapshot.
 */
export async function getUserRank(
  userId: string,
  track: LeaderboardTrack,
  scope: LeaderboardScope,
  db: DatabaseAdapter,
  options?: { city?: string; guildId?: string; seasonId?: string; country?: string }
): Promise<number | null> {
  // BUG-M04: The original implementation used two separate queries (fetch user XP,
  // then count higher-ranked users). Between them, other users' XP could change,
  // producing a stale rank. Replaced with a single CTE that reads the user's XP
  // and computes the rank atomically from the same snapshot of the table.

  if (scope === "national" && !options?.country) {
    throw new Error("country is required for national leaderboard scope");
  }

  // Map scope to the stored scope value (national uses global rows filtered by country)
  const dbScope = scope === "national" ? "global" : scope;

  // Build the scope conditions shared by both the my_xp CTE and the rank count.
  const rankConditions: string[] = [
    `ls.track = $1`,
    `ls.scope = $2`,
    `u.deleted_at IS NULL`,
  ];
  const params: (string | number | null)[] = [track, dbScope];
  let paramIdx = 3;

  if (scope === "national" && options?.country) {
    rankConditions.push(`COALESCE(u.country, '') = $${paramIdx++}`);
    params.push(options.country);
  } else if (scope === "city" && options?.city) {
    rankConditions.push(`ls.city = $${paramIdx++}`);
    params.push(options.city);
  } else if (scope === "guild" && options?.guildId) {
    rankConditions.push(`u.guild_id = $${paramIdx++}`);
    params.push(options.guildId);
  }

  if (options?.seasonId) {
    rankConditions.push(`ls.season_id = $${paramIdx++}`);
    params.push(options.seasonId);
  } else {
    rankConditions.push(`ls.season_id IS NULL`);
  }

  if (scope !== "city") {
    rankConditions.push(`ls.city IS NULL`);
  }

  // userId placeholder for the CTE user filter and rank exclusion
  const userIdIdx = paramIdx++;
  params.push(userId);

  const cityParam = options?.city ?? null;
  const seasonParam = options?.seasonId ?? null;
  const cityIdx = paramIdx++;
  const seasonIdx = paramIdx++;
  params.push(cityParam, seasonParam);

  const { rows } = await db.query<{ rank: string | null }>(
    `WITH my_xp AS (
       SELECT xp_value
       FROM leaderboard_snapshots
       WHERE user_id = $${userIdIdx}
         AND track = $1
         AND scope = $2
         AND (city IS NOT DISTINCT FROM $${cityIdx})
         AND (season_id IS NOT DISTINCT FROM $${seasonIdx})
       LIMIT 1
     )
     SELECT
       CASE WHEN (SELECT xp_value FROM my_xp) IS NULL THEN NULL
            ELSE (
              SELECT COUNT(*) + 1
              FROM leaderboard_snapshots ls
              JOIN users u ON u.id = ls.user_id
              WHERE ${rankConditions.join(" AND ")}
                AND ls.xp_value > (SELECT xp_value FROM my_xp)
            )
       END AS rank`,
    params
  );

  const rankVal = rows[0]?.rank;
  if (rankVal === null || rankVal === undefined) return null;
  return parseInt(rankVal);
}

// ---------------------------------------------------------------------------
// getLeaderboard
// ---------------------------------------------------------------------------

/**
 * Returns a paginated leaderboard for the given track and scope.
 *
 * Results are sourced from the materialised leaderboard_snapshots table.
 *
 * @param track    - XP track to sort by.
 * @param scope    - Scope filter (global, city, guild, season).
 * @param city     - Required when scope = 'city'.
 * @param page     - 1-indexed page number.
 * @param db       - Active database adapter.
 * @param options  - Additional scope parameters.
 * @returns Paginated leaderboard page.
 */
export async function getLeaderboard(
  track: LeaderboardTrack,
  scope: LeaderboardScope,
  city: string | null,
  page: number,
  db: DatabaseAdapter,
  options?: {
    pageSize?: number;
    guildId?: string;
    seasonId?: string;
    country?: string;
    /** When provided, uses cursor-based pagination instead of OFFSET. Ignores `page`. */
    cursor?: LeaderboardCursor | null;
  }
): Promise<LeaderboardPage> {
  const pageSize = Math.min(options?.pageSize ?? 100, 200);
  const cursor = options?.cursor ?? null;
  // BUG-41 FIX: OFFSET on large tables causes O(N) full-table scans that grow
  // with each page. Cursor-based pagination is required for page > 1.
  // Page 1 without a cursor is still allowed (OFFSET 0 is effectively a no-op).
  const normalPage = Math.max(page, 1);
  if (!cursor && normalPage > 1) {
    throw new Error(
      "[getLeaderboard] OFFSET-based pagination is disabled for page > 1. " +
      "Pass a cursor returned from the previous page instead."
    );
  }
  // LB-01: for cursor pages, ROW_NUMBER() restarts at 1 because the WHERE clause
  // filters out higher-ranked rows. cursor.rank carries the global rank of the last
  // entry on the previous page so we can shift ROW_NUMBER back to the true position.
  const rankOffset = cursor?.rank ?? 0;

  // Map scope to the stored scope value (national uses global rows filtered by country)
  const dbScope = scope === "national" ? "global" : scope;

  const conditions: string[] = [
    `ls.track = $1`,
    `ls.scope = $2`,
    `u.deleted_at IS NULL`,
  ];
  const params: (string | number | null)[] = [track, dbScope];
  let paramIdx = 3;

  if (scope === "national") {
    if (!options?.country) {
      throw new Error("country is required for national leaderboard scope");
    }
    conditions.push(`COALESCE(u.country, '') = $${paramIdx++}`);
    params.push(options.country);
  } else if (scope === "city" && city) {
    conditions.push(`ls.city = $${paramIdx++}`);
    params.push(city);
  } else if (scope === "guild" && options?.guildId) {
    conditions.push(`u.guild_id = $${paramIdx++}`);
    params.push(options.guildId);
  }

  if (options?.seasonId) {
    conditions.push(`ls.season_id = $${paramIdx++}`);
    params.push(options.seasonId);
  } else {
    conditions.push(`ls.season_id IS NULL`);
  }

  // City filter for city scope
  if (scope !== "city") {
    conditions.push(`ls.city IS NULL`);
  }

  // Cursor condition: keyset pagination avoids O(N) OFFSET scans
  if (cursor) {
    conditions.push(`(ls.xp_value, ls.user_id) < ($${paramIdx}, $${paramIdx + 1})`);
    params.push(cursor.xpValue, cursor.userId);
    paramIdx += 2;
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  type RawRow = LeaderboardEntry & { total_count: string };

  const queryText = `SELECT
       ROW_NUMBER() OVER (ORDER BY ls.xp_value DESC NULLS LAST, ls.user_id ASC) AS rank,
       ls.user_id,
       u.username,
       u.display_name,
       u.avatar_emoji,
       u.rank_name,
       COALESCE(ls.xp_value, 0) AS xp_value,
       u.city,
       COUNT(*) OVER () AS total_count
     FROM leaderboard_snapshots ls
     JOIN users u ON u.id = ls.user_id
     ${where}
     ORDER BY ls.xp_value DESC NULLS LAST, ls.user_id ASC
     LIMIT $${paramIdx}`;

  const queryParams = [...params, pageSize];

  const { rows } = await db.query<RawRow>(queryText, queryParams);

  const total = parseInt(rows[0]?.total_count ?? "0");
  let hofCount = 0;
  const entries: LeaderboardEntry[] = rows.map((r) => ({
    // LB-01: add rankOffset so cursor pages show true global rank, not page-local ROW_NUMBER
    rank: rankOffset + Number(r.rank),
    user_id: r.user_id,
    username: r.username,
    display_name: r.display_name,
    avatar_emoji: r.avatar_emoji,
    rank_name: r.rank_name,
    xp_value: Number(r.xp_value),
    city: r.city,
  }));

  // PRD §9: Hall of Fame users (Prestige 10) have permanent top-100 visibility on
  // the global main leaderboard. On the first page (no cursor) of the global/main leaderboard,
  // fetch HoF users not already in the result set.
  const isFirstPage = cursor === null;
  if (scope === "global" && track === "main" && isFirstPage) {
    try {
      interface HofRow {
        user_id: string;
        username: string;
        display_name: string;
        avatar_emoji: string;
        rank_name: string;
        xp_value: string;
        city: string | null;
        custom_crest: string | null;
      }
      const presentIds = new Set(entries.map((e) => e.user_id));
      const { rows: hofRows } = await db.query<HofRow>(
        `SELECT
           hof.user_id,
           u.username,
           u.display_name,
           u.avatar_emoji,
           u.rank_name,
           COALESCE(ls.xp_value, u.legacy_score, 0)::text AS xp_value,
           u.city,
           u.custom_crest
         FROM hall_of_fame hof
         JOIN users u ON u.id = hof.user_id AND u.deleted_at IS NULL
         LEFT JOIN leaderboard_snapshots ls ON ls.user_id = hof.user_id
           AND ls.track = 'main' AND ls.scope = 'global' AND ls.city IS NULL
           AND ls.season_id IS NULL
         ORDER BY COALESCE(ls.xp_value, u.legacy_score, 0) DESC`
      );

      // Mark already-present HoF users
      for (const hof of hofRows) {
        if (presentIds.has(hof.user_id)) {
          const existing = entries.find((e) => e.user_id === hof.user_id);
          if (existing) {
            existing.is_hall_of_fame = true;
            existing.custom_crest = hof.custom_crest ?? null;
          }
        }
      }

      // BUG-11: Batch-fetch ranks for HoF users not already in the result set —
      // replaces one getUserRank call (2 DB round-trips) per missing user with a
      // single COUNT(*)+1 subquery across all missing users at once.
      //
      // BUG-HOF-01 FIX: for HoF users with no leaderboard_snapshots row, the
      // original query used COALESCE(ls.xp_value, 0) = 0 which placed them at
      // rank = (all users with any XP) + 1, injecting them at the bottom of the
      // list. We now detect the no-snapshot case via `has_snapshot` and assign
      // rank = total + 1 for these users. The `is_hall_of_fame: true` flag lets
      // the frontend render them in a visually distinct pinned section above the
      // ranked list, not mixed into rank-ordered entries.
      const missingHof = hofRows.filter((h) => !presentIds.has(h.user_id));
      if (missingHof.length > 0) {
        const missingIds = missingHof.map((h) => h.user_id);
        const { rows: rankRows } = await db.query<{ user_id: string; rank: string | null; has_snapshot: boolean }>(
          `SELECT
             target.user_id,
             ls.user_id IS NOT NULL AS has_snapshot,
             CASE WHEN ls.user_id IS NULL THEN NULL
               ELSE (SELECT COUNT(*) + 1
                     FROM leaderboard_snapshots ls2
                     JOIN users u2 ON u2.id = ls2.user_id AND u2.deleted_at IS NULL
                     WHERE ls2.track = 'main' AND ls2.scope = 'global'
                       AND ls2.season_id IS NULL
                       AND ls2.xp_value > COALESCE(ls.xp_value, 0))::text
             END AS rank
           FROM leaderboard_snapshots ls
           RIGHT JOIN (SELECT unnest($1::uuid[]) AS user_id) target ON ls.user_id = target.user_id
             AND ls.track = 'main' AND ls.scope = 'global' AND ls.season_id IS NULL`,
          [missingIds]
        );
        const rankMap = new Map(rankRows.map((r) => [
          r.user_id,
          // null rank means no snapshot — assign total+1 (honest "unranked" position)
          r.rank !== null ? parseInt(r.rank) : null,
        ]));

        for (const hof of missingHof) {
          const computedRank = rankMap.get(hof.user_id);
          entries.push({
            // null → no snapshot: place at total+1 so the frontend can detect
            // and pin these in a separate HoF section, not in the ranked list.
            rank: computedRank ?? (total + 1),
            user_id: hof.user_id,
            username: hof.username,
            display_name: hof.display_name,
            avatar_emoji: hof.avatar_emoji,
            rank_name: hof.rank_name,
            xp_value: Number(hof.xp_value),
            city: hof.city,
            is_hall_of_fame: true,
            custom_crest: hof.custom_crest ?? null,
          });
        }
        hofCount += missingHof.length; // HoF count is separate from ranked total so pagination is consistent
      }
    } catch {
      // Hall of Fame injection is best-effort — never breaks the leaderboard
    }

    // BUG-13: cap entries to pageSize after HoF injection to avoid over-returning
    if (entries.length > pageSize) {
      entries.length = pageSize;
    }
  }

  const hasMore = rows.length === pageSize;

  const lastEntry = rows[rows.length - 1];
  const nextCursor: LeaderboardCursor | null =
    hasMore && lastEntry
      ? { xpValue: Number(lastEntry.xp_value), userId: lastEntry.user_id, rank: rankOffset + rows.length }
      : null;

  return {
    entries,
    total,
    hofCount,
    page,
    pageSize,
    hasMore,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// upsertLeaderboardSnapshot
// ---------------------------------------------------------------------------

/**
 * Materialises (upserts) a user's XP value for a given track in the
 * leaderboard_snapshots table. Should be called every time XP is awarded.
 *
 * Uses IS NOT DISTINCT FROM for NULL-safe comparison since city and season_id
 * may be NULL and PostgreSQL UNIQUE constraints treat NULLs as distinct.
 *
 * @param userId   - UUID of the user receiving XP.
 * @param track    - The track that received the XP.
 * @param xpValue  - The user's new total XP value on this track.
 * @param db       - Active database adapter.
 * @param options  - Optional scope/city/seasonId overrides.
 */
export async function upsertLeaderboardSnapshot(
  userId: string,
  track: LeaderboardTrack,
  xpValue: number,
  db: DatabaseAdapter | TransactionClient,
  options?: { scope?: string; city?: string; seasonId?: string }
): Promise<void> {
  const scope = options?.scope ?? "global";
  const city = options?.city ?? null;
  const seasonId = options?.seasonId ?? null;

  // Single atomic upsert — no TOCTOU between UPDATE check and INSERT.
  // IMPORTANT (TASK-10): The ON CONFLICT clause MUST exactly match the expression
  // unique index created in migration 0001_consolidated_schema.sql (leaderboard_snapshots_upsert_idx).
  // If either is changed, PostgreSQL will fall back to INSERT and silently create duplicates.
  // Index definition: ON leaderboard_snapshots (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
  await db.query(
    `INSERT INTO leaderboard_snapshots
       (user_id, track, scope, city, season_id, xp_value, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
     DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
    [userId, track, scope, city, seasonId, xpValue]
  );
}

// Rankings are based on raw XP from leaderboard_snapshots — no weighted scoring.
