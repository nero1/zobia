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
  options?: { city?: string; guildId?: string; seasonId?: string }
): Promise<number | null> {
  // Get the user's own xp_value from the snapshot for this track/scope
  const { rows: userRows } = await db.query<{ xp_value: string }>(
    `SELECT xp_value FROM leaderboard_snapshots
     WHERE user_id = $1 AND track = $2 AND scope = $3
       AND (city IS NOT DISTINCT FROM $4)
       AND (season_id IS NOT DISTINCT FROM $5)
     LIMIT 1`,
    [userId, track, scope === "national" ? "global" : scope,
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
  const params: (string | number | null)[] = [track, scope === "national" ? "global" : scope, userXP, userId];
  let paramIdx = 5;

  if (scope === "national") {
    conditions.push(`COALESCE(u.country, '') = 'NG'`);
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
    conditions.push(`COALESCE(u.country, '') = 'NG'`);
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
       ROW_NUMBER() OVER (ORDER BY ls.xp_value DESC NULLS LAST) AS rank,
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
     ORDER BY ls.xp_value DESC NULLS LAST
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

      for (const hof of hofRows) {
        if (presentIds.has(hof.user_id)) {
          // Already in the list — mark as Hall of Fame
          const existing = entries.find((e) => e.user_id === hof.user_id);
          if (existing) {
            existing.is_hall_of_fame = true;
            existing.custom_crest = hof.custom_crest ?? null;
          }
        } else if (entries.length < 100) {
          // Pin this Hall of Fame user — they always appear in the top 100
          const hofRank = await getUserRank(hof.user_id, "main", "global", db) ?? (entries.length + 1);
          entries.push({
            rank: hofRank,
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
  db: DatabaseAdapter,
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
     ON CONFLICT (user_id, track, scope, city, season_id)
     DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
    [userId, track, scope, city, seasonId, xpValue]
  );
}

// ---------------------------------------------------------------------------
// Weighted Leaderboard Scoring
// ---------------------------------------------------------------------------

/**
 * Calculate weighted leaderboard score combining multiple engagement metrics.
 *
 * @param xpTotal - Total XP earned (0-unlimited)
 * @param memberGrowthRate - Member growth rate as decimal (0-1, where 1 = 100% growth)
 * @param questCompletionRate - Completion rate for assigned quests (0-1)
 * @param contentConsistencyScore - Content posting consistency (0-100)
 * @returns Weighted composite score (0+)
 *
 * Weights:
 *  - XP (40%): Primary engagement signal
 *  - Member Growth (30%): Community building
 *  - Quest Completion (20%): Goal achievement
 *  - Content Consistency (10%): Regular engagement
 */
export function calculateWeightedScore(
  xpTotal: number,
  memberGrowthRate: number,
  questCompletionRate: number,
  contentConsistencyScore: number
): number {
  const xpWeight = 0.4;
  const growthWeight = 0.3;
  const questWeight = 0.2;
  const consistencyWeight = 0.1;

  // Normalize XP to 0-100 scale (assuming 100k XP = 100 points)
  const normalizedXP = Math.min((xpTotal / 100000) * 100, 100);

  // Growth rate is already 0-1, scale to 0-100
  const normalizedGrowth = memberGrowthRate * 100;

  // Quest completion is 0-1, scale to 0-100
  const normalizedQuests = questCompletionRate * 100;

  // Consistency is already 0-100
  const normalizedConsistency = contentConsistencyScore;

  // Calculate weighted score
  const score =
    normalizedXP * xpWeight +
    normalizedGrowth * growthWeight +
    normalizedQuests * questWeight +
    normalizedConsistency * consistencyWeight;

  return Math.round(score);
}

/**
 * Fetch user metrics for weighted leaderboard scoring.
 * Returns raw metrics that can be passed to calculateWeightedScore.
 */
export async function getUserMetricsForWeighting(
  userId: string,
  db: DatabaseAdapter
): Promise<{
  xpTotal: number;
  memberGrowthRate: number;
  questCompletionRate: number;
  contentConsistencyScore: number;
}> {
  // 1. Get total XP
  const { rows: xpRows } = await db.query<{ xp_total: string }>(
    `SELECT COALESCE(xp_total, 0) AS xp_total FROM users WHERE id = $1`,
    [userId]
  );
  const xpTotal = parseInt(xpRows[0]?.xp_total ?? '0', 10);

  // 2. Calculate member growth rate (followers / weeks active, capped at 1.0)
  const { rows: memberRows } = await db.query<{ follower_count: string; weeks_active: string }>(
    `SELECT
       COUNT(DISTINCT f.follower_id)::text AS follower_count,
       CEIL(EXTRACT(EPOCH FROM (NOW() - u.created_at)) / (7 * 86400))::text AS weeks_active
     FROM users u
     LEFT JOIN follows f ON f.following_id = u.id
     WHERE u.id = $1
     GROUP BY u.id, u.created_at`,
    [userId]
  );
  const followerCount = parseInt(memberRows[0]?.follower_count ?? '0', 10);
  const weeksActive = Math.max(parseInt(memberRows[0]?.weeks_active ?? '1', 10), 1);
  const memberGrowthRate = Math.min((followerCount / weeksActive) / 10, 1.0); // Target: 10 new followers/week

  // 3. Calculate quest completion rate (last 30 days)
  const { rows: questRows } = await db.query<{ completed: string; total: string }>(
    `SELECT
       COUNT(CASE WHEN completed = true THEN 1 END)::text AS completed,
       COUNT(*)::text AS total
     FROM user_quest_progress
     WHERE user_id = $1
       AND quest_date >= CURRENT_DATE - INTERVAL '30 days'`,
    [userId]
  );
  const completedQuests = parseInt(questRows[0]?.completed ?? '0', 10);
  const totalQuests = parseInt(questRows[0]?.total ?? '1', 10);
  const questCompletionRate = totalQuests > 0 ? completedQuests / totalQuests : 0;

  // 4. Calculate content consistency score
  // Measure: posts per week over last 12 weeks (0-100 scale, where 7+ posts/week = 100)
  const { rows: contentRows } = await db.query<{ posts_count: string }>(
    `SELECT COUNT(*)::text AS posts_count
     FROM messages
     WHERE sender_id = $1
       AND created_at >= CURRENT_DATE - INTERVAL '84 days'
       AND is_deleted = false`,
    [userId]
  );
  const postsLast12Weeks = parseInt(contentRows[0]?.posts_count ?? '0', 10);
  const postsPerWeek = postsLast12Weeks / 12;
  const contentConsistencyScore = Math.min((postsPerWeek / 7) * 100, 100);

  return {
    xpTotal,
    memberGrowthRate,
    questCompletionRate,
    contentConsistencyScore,
  };
}
