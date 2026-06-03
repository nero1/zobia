/**
 * lib/leaderboards/engine.ts
 *
 * Leaderboard utility functions.
 *
 * Leaderboards are materialised at write time:
 *  - When XP is awarded, leaderboard_snapshots is updated via upsert.
 *  - Read paths query the snapshot table (never calculate live from xp_ledger).
 *
 * Scopes: global | city | guild | season
 * Tracks: main | social | creator | competitor | generosity | knowledge | explorer
 */

import type { DatabaseAdapter } from "@/lib/db/interface";

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
  | "explorer";

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  rank_name: string;
  xp_value: number;
  city: string | null;
}

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the SQL column expression for the given track.
 * All snapshot values are stored in the leaderboard_snapshots table.
 */
function trackColumn(track: LeaderboardTrack): string {
  if (track === "main") return "ls.xp_main";
  return `ls.xp_${track}`;
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
  options?: { city?: string; guildId?: string; seasonId?: string }
): Promise<number | null> {
  const col = trackColumn(track);

  let scopeCondition = "";
  const params: (string | null)[] = [userId];
  let paramIdx = 2;

  if (scope === "national") {
    scopeCondition = `AND COALESCE(u.country, '') = 'NG'`;
  } else if (scope === "city" && options?.city) {
    scopeCondition = `AND u.city = $${paramIdx++}`;
    params.push(options.city);
  } else if (scope === "guild" && options?.guildId) {
    scopeCondition = `AND u.guild_id = $${paramIdx++}`;
    params.push(options.guildId);
  } else if (scope === "season" && options?.seasonId) {
    scopeCondition = `AND ls.season_id = $${paramIdx++}`;
    params.push(options.seasonId);
  }

  const { rows } = await db.query<{ rank: string }>(
    `SELECT COUNT(*) + 1 AS rank
     FROM leaderboard_snapshots ls
     JOIN users u ON u.id = ls.user_id
     WHERE ls.user_id != $1
       AND ${col} > (
         SELECT COALESCE(${col}, 0) FROM leaderboard_snapshots WHERE user_id = $1 LIMIT 1
       )
       ${scopeCondition}`,
    params
  );

  const rank = parseInt(rows[0]?.rank ?? "0");
  return rank > 0 ? rank : null;
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
  }
): Promise<LeaderboardPage> {
  const pageSize = Math.min(options?.pageSize ?? 100, 200);
  const offset = (Math.max(page, 1) - 1) * pageSize;
  const col = trackColumn(track);

  const conditions: string[] = ["ls.user_id IS NOT NULL", "u.deleted_at IS NULL"];
  const params: (string | number | null)[] = [];
  let paramIdx = 1;

  if (scope === "national") {
    conditions.push(`COALESCE(u.country, '') = 'NG'`);
  } else if (scope === "city" && city) {
    conditions.push(`u.city = $${paramIdx++}`);
    params.push(city);
  } else if (scope === "guild" && options?.guildId) {
    conditions.push(`u.guild_id = $${paramIdx++}`);
    params.push(options.guildId);
  } else if (scope === "season" && options?.seasonId) {
    conditions.push(`ls.season_id = $${paramIdx++}`);
    params.push(options.seasonId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  type RawRow = LeaderboardEntry & { total_count: string };

  const { rows } = await db.query<RawRow>(
    `SELECT
       ROW_NUMBER() OVER (ORDER BY ${col} DESC NULLS LAST) AS rank,
       ls.user_id,
       u.username,
       u.display_name,
       u.avatar_emoji,
       u.rank_name,
       COALESCE(${col}, 0) AS xp_value,
       u.city,
       COUNT(*) OVER () AS total_count
     FROM leaderboard_snapshots ls
     JOIN users u ON u.id = ls.user_id
     ${where}
     ORDER BY ${col} DESC NULLS LAST
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
 * @param userId  - UUID of the user receiving XP.
 * @param track   - The track that received the XP.
 * @param xpValue - The user's new total XP value on this track.
 * @param db      - Active database adapter.
 */
export async function upsertLeaderboardSnapshot(
  userId: string,
  track: LeaderboardTrack,
  xpValue: number,
  db: DatabaseAdapter
): Promise<void> {
  const col = trackColumn(track);
  await db.query(
    `INSERT INTO leaderboard_snapshots (user_id, ${col}, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET ${col} = $2, updated_at = NOW()`,
    [userId, xpValue]
  );
}
