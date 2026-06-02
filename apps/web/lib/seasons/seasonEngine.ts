/**
 * lib/seasons/seasonEngine.ts
 *
 * Season management engine.
 *
 * Handles season lifecycle: detecting the active season, computing the current
 * phase, resetting competitive rankings at season end, archiving per-user
 * season history, and distributing top-performer rewards.
 */

import type { DatabaseAdapter } from "@/lib/db/interface";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Season {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
  reward_pool_coins: number;
  created_at: string;
}

/** Phase within a season timeline. */
export type SeasonPhase = "opening" | "mid" | "push" | "final_day";

// ---------------------------------------------------------------------------
// getCurrentSeason
// ---------------------------------------------------------------------------

/**
 * Returns the currently active season row, or null if no season is live.
 *
 * @param db - Active database adapter.
 * @returns The active Season or null.
 */
export async function getCurrentSeason(db: DatabaseAdapter): Promise<Season | null> {
  const { rows } = await db.query<Season>(
    `SELECT id, name, theme, starts_at, ends_at, is_active,
            pass_price_coins, reward_pool_coins, created_at
     FROM seasons
     WHERE is_active = TRUE AND starts_at <= NOW() AND ends_at > NOW()
     ORDER BY starts_at DESC
     LIMIT 1`,
    []
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// isSeasonActive
// ---------------------------------------------------------------------------

/**
 * Returns true if the given season is currently active based on timestamps.
 *
 * @param season - Season object from the database.
 * @returns Boolean indicating whether the season is live.
 */
export function isSeasonActive(season: Season): boolean {
  const now = Date.now();
  return (
    season.is_active &&
    new Date(season.starts_at).getTime() <= now &&
    new Date(season.ends_at).getTime() > now
  );
}

// ---------------------------------------------------------------------------
// getSeasonPhase
// ---------------------------------------------------------------------------

/**
 * Calculates the current phase of a season based on elapsed time.
 *
 *  - opening   : First 25% of the season duration
 *  - mid       : 25% – 75% of the season
 *  - push      : 75% – 95% of the season
 *  - final_day : Last 5% (or last 24 hours, whichever is smaller)
 *
 * @param season - The season to evaluate.
 * @returns The current phase string.
 */
export function getSeasonPhase(season: Season): SeasonPhase {
  const start = new Date(season.starts_at).getTime();
  const end = new Date(season.ends_at).getTime();
  const now = Date.now();
  const total = end - start;
  const elapsed = Math.max(0, now - start);
  const ratio = elapsed / total;

  if (ratio >= 0.95 || end - now <= 24 * 60 * 60 * 1000) return "final_day";
  if (ratio >= 0.75) return "push";
  if (ratio >= 0.25) return "mid";
  return "opening";
}

// ---------------------------------------------------------------------------
// resetSeasonRankings
// ---------------------------------------------------------------------------

/**
 * Resets competitive (season-specific) rankings at season end.
 *
 * Only resets the season_rank column and seasonal leaderboard snapshot.
 * Main XP, coins, items, guild membership, and track XP are all preserved.
 *
 * @param seasonId - UUID of the season that just ended.
 * @param db       - Active database adapter.
 */
export async function resetSeasonRankings(
  seasonId: string,
  db: DatabaseAdapter
): Promise<void> {
  await db.transaction(async (client) => {
    // Archive leaderboard positions before clearing
    await client.query(
      `INSERT INTO season_rank_archives (season_id, user_id, final_rank, final_season_xp, archived_at)
       SELECT $1, user_id, season_rank, season_xp, NOW()
       FROM user_season_passes
       WHERE season_id = $1
       ON CONFLICT (season_id, user_id) DO NOTHING`,
      [seasonId]
    );

    // Reset per-season XP and rank
    await client.query(
      `UPDATE user_season_passes
       SET season_xp = 0, season_rank = NULL
       WHERE season_id = $1`,
      [seasonId]
    );

    // Mark season as inactive
    await client.query(
      `UPDATE seasons SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [seasonId]
    );
  });
}

// ---------------------------------------------------------------------------
// archiveSeasonForUser
// ---------------------------------------------------------------------------

/**
 * Archives the season result for a single user. Called per-user at season end.
 * Safe to call multiple times (upserts on conflict).
 *
 * @param userId     - UUID of the user.
 * @param seasonId   - UUID of the season.
 * @param finalRank  - The user's final leaderboard rank number.
 * @param db         - Active database adapter.
 */
export async function archiveSeasonForUser(
  userId: string,
  seasonId: string,
  finalRank: number,
  db: DatabaseAdapter
): Promise<void> {
  await db.query(
    `INSERT INTO season_rank_archives (season_id, user_id, final_rank, final_season_xp, archived_at)
     SELECT $1, $2, $3, COALESCE(usp.season_xp, 0), NOW()
     FROM user_season_passes usp
     WHERE usp.season_id = $1 AND usp.user_id = $2
     ON CONFLICT (season_id, user_id) DO UPDATE
       SET final_rank = EXCLUDED.final_rank,
           archived_at = EXCLUDED.archived_at`,
    [seasonId, userId, finalRank]
  );
}

// ---------------------------------------------------------------------------
// distributeSeasonRewards
// ---------------------------------------------------------------------------

/**
 * Distributes season end rewards to top performers.
 *
 * Reward tiers (based on the season's reward_pool_coins):
 *  - Rank 1:      25% of pool
 *  - Rank 2:      15% of pool
 *  - Rank 3:      10% of pool
 *  - Rank 4–10:   5% of pool each (50% total, evenly split across 7 users)
 *  - All top-10 receive an exclusive season badge recorded in user_badges
 *
 * @param seasonId - UUID of the ended season.
 * @param db       - Active database adapter.
 */
export async function distributeSeasonRewards(
  seasonId: string,
  db: DatabaseAdapter
): Promise<void> {
  const seasonResult = await db.query<{ reward_pool_coins: number }>(
    `SELECT reward_pool_coins FROM seasons WHERE id = $1`,
    [seasonId]
  );
  const season = seasonResult.rows[0];
  if (!season) throw new Error(`[seasonEngine] Season not found: ${seasonId}`);

  const pool = season.reward_pool_coins;

  // Top 10 by final_rank
  const rankResult = await db.query<{ user_id: string; final_rank: number }>(
    `SELECT user_id, final_rank
     FROM season_rank_archives
     WHERE season_id = $1 AND final_rank IS NOT NULL
     ORDER BY final_rank ASC
     LIMIT 10`,
    [seasonId]
  );

  const topUsers = rankResult.rows;
  const rewardShares = [0.25, 0.15, 0.1];
  const rank4to10Share = topUsers.length > 3
    ? Math.floor((pool * 0.5) / Math.max(topUsers.length - 3, 1))
    : 0;

  await db.transaction(async (client) => {
    for (let i = 0; i < topUsers.length; i++) {
      const { user_id } = topUsers[i];
      let coins = i < 3 ? Math.floor(pool * rewardShares[i]) : rank4to10Share;

      if (coins > 0) {
        await client.query(
          `UPDATE users SET coin_balance = coin_balance + $1, updated_at = NOW() WHERE id = $2`,
          [coins, user_id]
        );
        await client.query(
          `INSERT INTO coin_ledger (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, created_at)
           SELECT $1, $2, coin_balance - $2, coin_balance, 'season_reward', $3, 'Season end reward', NOW()
           FROM users WHERE id = $1`,
          [user_id, coins, seasonId]
        );
      }

      // Award season badge
      await client.query(
        `INSERT INTO user_badges (user_id, badge_type, reference_id, awarded_at)
         VALUES ($1, 'season_top10', $2, NOW())
         ON CONFLICT (user_id, badge_type, reference_id) DO NOTHING`,
        [user_id, seasonId]
      );
    }
  });
}
