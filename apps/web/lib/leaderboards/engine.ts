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

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
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
  // Get the user's own xp_value from the snapshot for this track/scope
  const { rows: userRows } = await db.query<{ xp_value: string }>(
    `SELECT xp_value FROM leaderboard_snapshots
     WHERE user_id = $1 AND track = $2 AND scope = $3
       AND (city IS NOT DISTINCT FROM $4)
       AND (season_id IS NOT DISTINCT FROM $5)
     LIMIT 1`,
    [userId, track, scope,
     options?.city ?? null, options?.seasonId ?? null]
  );

  if (!userRows[0]) return null;
  const userXP = parseInt(userRows[0].xp_value);

  // Build scope conditions for the rank count
  const conditions: string[] = [
    `ls.track = $1`,
    `ls.scope = $2`,
    `u.deleted_at IS NULL`,
    `ls.xp_value > $3`,
    `ls.user_id != $4`,
  ];
  const params: (string | number | null)[] = [track, scope, userXP, userId];
  let paramIdx = 5;

  if (scope === "national") {
    if (!options?.country) {
      throw new Error("country is required for national leaderboard scope");
    }
    conditions.push(`COALESCE(u.country, '') = $${paramIdx++}`);
    params.push(options.country);
  } else if (scope === "city" && options?.city) {
    conditions.push(`ls.city = $${paramIdx++}`);
    params.push(options.city);
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

  // For non-city scopes, exclude rows that have a city value (those belong to city leaderboards)
  if (scope !== "city") {
    conditions.push(`ls.city IS NULL`);
  }

  const { rows } = await db.query<{ rank: string }>(
    `SELECT COUNT(*) + 1 AS rank
     FROM leaderboard_snapshots ls
     JOIN users u ON u.id = ls.user_id
     WHERE ${conditions.join(" AND ")}`,
    params
  );

  const rank = parseInt(rows[0]?.rank ?? "1");
  return rank;
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
  }
): Promise<LeaderboardPage> {
  const pageSize = Math.min(options?.pageSize ?? 100, 200);
  const offset = (Math.max(page, 1) - 1) * pageSize;

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

  const where = `WHERE ${conditions.join(" AND ")}`;

  type RawRow = LeaderboardEntry & { total_count: string };

  const { rows } = await db.query<RawRow>(
    `SELECT
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
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, pageSize, offset]
  );

  const total = parseInt(rows[0]?.total_count ?? "0");
  const entries: LeaderboardEntry[] = rows.map((r) => ({
    rank: Number(r.rank),
    user_id: r.user_id,
    username: r.username,
    display_name: r.display_name,
    avatar_emoji: r.avatar_emoji,
    rank_name: r.rank_name,
    xp_value: Number(r.xp_value),
    city: r.city,
  }));

  // PRD §9: Hall of Fame users (Prestige 10) have permanent top-100 visibility on
  // the global main leaderboard. On page 1 of the global/main leaderboard, fetch
  // Hall of Fame users not already in the result set and pin them to the list.
  if (scope === "global" && track === "main" && page === 1) {
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
      const missingHof = hofRows.filter((h) => !presentIds.has(h.user_id) && entries.length < 100);
      if (missingHof.length > 0) {
        const missingIds = missingHof.map((h) => h.user_id);
        const { rows: rankRows } = await db.query<{ user_id: string; rank: string }>(
          `SELECT
             target.user_id,
             (SELECT COUNT(*) + 1
              FROM leaderboard_snapshots ls2
              JOIN users u2 ON u2.id = ls2.user_id AND u2.deleted_at IS NULL
              WHERE ls2.track = 'main' AND ls2.scope = 'global'
                AND ls2.season_id IS NULL
                AND ls2.xp_value > COALESCE(ls.xp_value, 0))::text AS rank
           FROM leaderboard_snapshots ls
           RIGHT JOIN (SELECT unnest($1::uuid[]) AS user_id) target ON ls.user_id = target.user_id
             AND ls.track = 'main' AND ls.scope = 'global' AND ls.season_id IS NULL`,
          [missingIds]
        );
        const rankMap = new Map(rankRows.map((r) => [r.user_id, parseInt(r.rank ?? "1")]));

        for (const hof of missingHof) {
          entries.push({
            rank: rankMap.get(hof.user_id) ?? (entries.length + 1),
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
      }
    } catch {
      // Hall of Fame injection is best-effort — never breaks the leaderboard
    }

    // BUG-13: cap entries to pageSize after HoF injection to avoid over-returning
    if (entries.length > pageSize) {
      entries.length = pageSize;
    }
  }

  return {
    entries,
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
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

  // Single atomic upsert — no TOCTOU between UPDATE check and INSERT
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
