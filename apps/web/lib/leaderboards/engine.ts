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

import { sql, type SQL } from "drizzle-orm";
import { type DbOrTx } from "@/lib/db/drizzle";
import { redis } from "@/lib/redis";
import { memGet, memSet } from "@/lib/cache/memory";

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
  /**
   * Subscription plan. Always selected from the DB but only surfaced by the
   * API route to Moderator/Admin requesters — regular users must not be able
   * to see another user's plan. See app/api/leaderboards/route.ts.
   */
  plan?: string;
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
 * @param db     - Drizzle db instance or an active transaction handle.
 * @returns The 1-based rank number, or null if the user has no snapshot.
 */
export async function getUserRank(
  userId: string,
  track: LeaderboardTrack,
  scope: LeaderboardScope,
  db: DbOrTx,
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

  // Build the scope conditions shared by the rank count.
  const rankConditions: SQL[] = [
    sql`ls.track = ${track}`,
    sql`ls.scope = ${dbScope}`,
    sql`u.deleted_at IS NULL`,
  ];

  if (scope === "national" && options?.country) {
    rankConditions.push(sql`COALESCE(u.country, '') = ${options.country}`);
  } else if (scope === "city" && options?.city) {
    rankConditions.push(sql`ls.city = ${options.city}`);
  } else if (scope === "guild" && options?.guildId) {
    rankConditions.push(sql`u.guild_id = ${options.guildId}`);
  }

  if (options?.seasonId) {
    rankConditions.push(sql`ls.season_id = ${options.seasonId}`);
  } else {
    rankConditions.push(sql`ls.season_id IS NULL`);
  }

  if (scope !== "city") {
    rankConditions.push(sql`ls.city IS NULL`);
  }

  const cityParam = options?.city ?? null;
  const seasonParam = options?.seasonId ?? null;

  const result = await db.execute<{ rank: string | null }>(sql`
    WITH my_xp AS (
      SELECT xp_value
      FROM leaderboard_snapshots
      WHERE user_id = ${userId}
        AND track = ${track}
        AND scope = ${dbScope}
        AND (city IS NOT DISTINCT FROM ${cityParam})
        AND (season_id IS NOT DISTINCT FROM ${seasonParam})
      LIMIT 1
    )
    SELECT
      CASE WHEN (SELECT xp_value FROM my_xp) IS NULL THEN NULL
           ELSE (
             SELECT COUNT(*) + 1
             FROM leaderboard_snapshots ls
             JOIN users u ON u.id = ls.user_id
             WHERE ${sql.join(rankConditions, sql` AND `)}
               AND ls.xp_value > (SELECT xp_value FROM my_xp)
           )
      END AS rank
  `);

  const rows = result.rows as { rank: string | null }[];
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
 * @param db       - Drizzle db instance or an active transaction handle.
 * @param options  - Additional scope parameters.
 * @returns Paginated leaderboard page.
 */
export async function getLeaderboard(
  track: LeaderboardTrack,
  scope: LeaderboardScope,
  city: string | null,
  page: number,
  db: DbOrTx,
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

  const conditions: SQL[] = [
    sql`ls.track = ${track}`,
    sql`ls.scope = ${dbScope}`,
    sql`u.deleted_at IS NULL`,
  ];

  if (scope === "national") {
    if (!options?.country) {
      throw new Error("country is required for national leaderboard scope");
    }
    conditions.push(sql`COALESCE(u.country, '') = ${options.country}`);
  } else if (scope === "city" && city) {
    conditions.push(sql`ls.city = ${city}`);
  } else if (scope === "guild" && options?.guildId) {
    conditions.push(sql`u.guild_id = ${options.guildId}`);
  }

  if (options?.seasonId) {
    conditions.push(sql`ls.season_id = ${options.seasonId}`);
  } else {
    conditions.push(sql`ls.season_id IS NULL`);
  }

  // City filter for city scope
  if (scope !== "city") {
    conditions.push(sql`ls.city IS NULL`);
  }

  // Count query uses the conditions WITHOUT the cursor condition — COUNT(*)
  // over a cursor-filtered query would return the current page's count only,
  // not the full result set (BUG-PERF-01) — so it is computed before the
  // cursor condition is appended below.
  const countWhere = sql.join(conditions, sql` AND `);

  // Cursor condition: keyset pagination avoids O(N) OFFSET scans
  if (cursor) {
    conditions.push(sql`(ls.xp_value, ls.user_id) < (${cursor.xpValue}, ${cursor.userId})`);
  }

  // Cache the total count to avoid a full-table count on every page flip.
  //
  // REDIS-COST-01: this is a GLOBAL value — the row count for a given
  // track/scope is identical for every user looking at that leaderboard — but
  // it had no in-process tier, so every leaderboard view from every user cost
  // at least one Redis GET (and a SET whenever the 60 s TTL lapsed). A warm
  // instance now answers from memory. The Redis tier is kept so a cold
  // instance still avoids the expensive COUNT(*), and its TTL is raised to
  // five minutes: a leaderboard's total row count barely moves, and a slightly
  // stale total only affects the reported page count, never the rows shown.
  const countCacheKey = `lb:count:${track}:${dbScope}:${city ?? ""}:${options?.seasonId ?? ""}:${options?.guildId ?? ""}`;
  const countMemKey = `mem:${countCacheKey}`;
  const COUNT_MEM_TTL_MS = 60_000;
  const COUNT_REDIS_TTL_SECONDS = 300;

  let total = memGet<number>(countMemKey) ?? 0;
  if (!memGet<number>(countMemKey)) {
    try {
      const cached = await redis.get(countCacheKey);
      if (cached !== null) {
        total = parseInt(cached, 10);
      } else {
        const countResult = await db.execute<{ count: string }>(
          sql`SELECT COUNT(*) AS count FROM leaderboard_snapshots ls JOIN users u ON u.id = ls.user_id WHERE ${countWhere}`
        );
        const countRows = countResult.rows as { count: string }[];
        total = parseInt(countRows[0]?.count ?? "0", 10);
        await redis.set(countCacheKey, String(total), "EX", COUNT_REDIS_TTL_SECONDS);
      }
      memSet(countMemKey, total, COUNT_MEM_TTL_MS);
    } catch {
      // Redis unavailable — fall through to 0; pagination will still work
    }
  }

  const where = sql.join(conditions, sql` AND `);

  const result = await db.execute<LeaderboardEntry & Record<string, unknown>>(sql`
    SELECT
      ROW_NUMBER() OVER (ORDER BY ls.xp_value DESC NULLS LAST, ls.user_id ASC) AS rank,
      ls.user_id,
      u.username,
      u.display_name,
      u.avatar_emoji,
      u.rank_name,
      COALESCE(ls.xp_value, 0) AS xp_value,
      u.city,
      u.plan
    FROM leaderboard_snapshots ls
    JOIN users u ON u.id = ls.user_id
    WHERE ${where}
    ORDER BY ls.xp_value DESC NULLS LAST, ls.user_id ASC
    LIMIT ${pageSize}
  `);

  const rows = result.rows as LeaderboardEntry[];
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
    plan: r.plan,
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
        plan: string;
      }
      const presentIds = new Set(entries.map((e) => e.user_id));
      const hofResult = await db.execute<HofRow & Record<string, unknown>>(sql`
        SELECT
          hof.user_id,
          u.username,
          u.display_name,
          u.avatar_emoji,
          u.rank_name,
          COALESCE(ls.xp_value, u.legacy_score, 0)::text AS xp_value,
          u.city,
          u.custom_crest,
          u.plan
        FROM hall_of_fame hof
        JOIN users u ON u.id = hof.user_id AND u.deleted_at IS NULL
        LEFT JOIN leaderboard_snapshots ls ON ls.user_id = hof.user_id
          AND ls.track = 'main' AND ls.scope = 'global' AND ls.city IS NULL
          AND ls.season_id IS NULL
        ORDER BY COALESCE(ls.xp_value, u.legacy_score, 0) DESC
      `);
      const hofRows = hofResult.rows as HofRow[];

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
        const rankResult = await db.execute<{ user_id: string; rank: string | null; has_snapshot: boolean }>(sql`
          SELECT
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
          RIGHT JOIN (SELECT unnest(${missingIds}::uuid[]) AS user_id) target ON ls.user_id = target.user_id
            AND ls.track = 'main' AND ls.scope = 'global' AND ls.season_id IS NULL
        `);
        const rankRows = rankResult.rows as { user_id: string; rank: string | null; has_snapshot: boolean }[];
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
            plan: hof.plan,
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
 * @param db       - Drizzle db instance or an active transaction handle.
 * @param options  - Optional scope/city/seasonId overrides.
 */
export async function upsertLeaderboardSnapshot(
  userId: string,
  track: LeaderboardTrack,
  xpValue: number,
  db: DbOrTx,
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
  //
  // Kept as a raw `sql` statement (executed through the Drizzle instance)
  // rather than the query builder's `.onConflictDoUpdate()` because the
  // conflict target is an expression index, which the query builder's
  // `target` option (column references only) cannot express.
  await db.execute(sql`
    INSERT INTO leaderboard_snapshots
      (user_id, track, scope, city, season_id, xp_value, updated_at)
    VALUES (${userId}, ${track}, ${scope}, ${city}, ${seasonId}, ${xpValue}, NOW())
    ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
    DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()
  `);
}

// Rankings are based on raw XP from leaderboard_snapshots — no weighted scoring.
