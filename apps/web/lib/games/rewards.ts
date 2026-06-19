/**
 * lib/games/rewards.ts
 *
 * Reward plumbing for the games feature. Everything that grants a player
 * credits / stars / gaming-XP goes through here so the economy ledgers, the
 * gaming progression track (xp_gaming / level_gaming) and the track-milestone
 * unlock engine stay consistent.
 *
 * All grants are idempotent via a stable `reference_id` so a retried request
 * never double-pays.
 */

import { db as globalDb } from "@/lib/db";
import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { getTrackLevelForXP } from "@/lib/xp/engine";
import { checkAndAwardTrackMilestones } from "@/lib/xp/trackMilestones";
import { logger } from "@/lib/logger";

export interface RewardBundle {
  credits: number;
  xp: number;
  stars: number;
}

/**
 * Grant a bundle of credits / gaming-XP / stars to a user, idempotently.
 * Recomputes the user's gaming level and fires any newly reached gaming track
 * milestones. Returns the bundle actually granted (zeros are skipped).
 */
export async function grantGamingReward(
  userId: string,
  bundle: RewardBundle,
  source: string,
  referenceId: string,
  client?: TransactionClient
): Promise<RewardBundle> {
  const credits = Math.max(0, Math.floor(bundle.credits));
  const xp = Math.max(0, Math.floor(bundle.xp));
  const stars = Math.max(0, Math.floor(bundle.stars));

  if (credits > 0) {
    await creditCoins(
      userId,
      credits,
      "game_reward",
      `${referenceId}:credits`,
      `Game reward: ${source}`,
      { source },
      client
    ).catch((err) => logger.error({ userId, source }, `[games] credit reward failed: ${err}`));
  }

  if (stars > 0) {
    await creditStars(
      userId,
      stars,
      "game_reward",
      `${referenceId}:stars`,
      `Game reward: ${source}`,
      client
    ).catch((err) => logger.error({ userId, source }, `[games] star reward failed: ${err}`));
  }

  if (xp > 0) {
    // safeAwardXP updates xp_total + xp_gaming. We then recompute level_gaming.
    await safeAwardXP(userId, xp, "gaming", source, `${referenceId}:xp`, client);
    await recomputeGamingLevel(userId, client ?? globalDb);
  }

  return { credits, xp, stars };
}

/**
 * Recompute level_gaming from xp_gaming and persist it, then award any track
 * milestones the user has newly reached. Best-effort (never throws).
 */
export async function recomputeGamingLevel(
  userId: string,
  client: DatabaseAdapter | TransactionClient
): Promise<void> {
  try {
    const { rows } = await (client as DatabaseAdapter).query<{ xp_gaming: number }>(
      `SELECT xp_gaming FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!rows[0]) return;
    const info = getTrackLevelForXP("gaming", rows[0].xp_gaming ?? 0);
    await (client as DatabaseAdapter).query(
      `UPDATE users SET level_gaming = $1, updated_at = NOW() WHERE id = $2`,
      [info.level, userId]
    );
    await checkAndAwardTrackMilestones(userId, "gaming", info.level, client as DatabaseAdapter);
  } catch (err) {
    logger.warn({ userId }, `[games] recomputeGamingLevel failed: ${err}`);
  }
}

/**
 * After a counted play, evaluate global "games played" milestones and grant any
 * unclaimed ones. Idempotent via the game_milestone_claims primary key.
 */
export async function checkPlayMilestones(userId: string): Promise<void> {
  try {
    const { rows: countRows } = await globalDb.query<{ plays: number }>(
      `SELECT COUNT(*)::int AS plays FROM game_plays WHERE user_id = $1 AND counted = TRUE`,
      [userId]
    );
    const totalPlays = countRows[0]?.plays ?? 0;
    if (totalPlays === 0) return;

    const { rows: milestones } = await globalDb.query<{
      games_played_threshold: number;
      reward_credits: number;
      reward_xp: number;
      reward_stars: number;
    }>(
      `SELECT m.games_played_threshold, m.reward_credits, m.reward_xp, m.reward_stars
       FROM game_play_milestones m
       WHERE m.is_active = TRUE
         AND m.games_played_threshold <= $1
         AND NOT EXISTS (
           SELECT 1 FROM game_milestone_claims c
           WHERE c.user_id = $2 AND c.threshold = m.games_played_threshold
         )
       ORDER BY m.games_played_threshold ASC`,
      [totalPlays, userId]
    );

    for (const m of milestones) {
      // Claim first (idempotency gate), then pay.
      const { rows: claimed } = await globalDb.query<{ threshold: number }>(
        `INSERT INTO game_milestone_claims (user_id, threshold)
         VALUES ($1, $2)
         ON CONFLICT (user_id, threshold) DO NOTHING
         RETURNING threshold`,
        [userId, m.games_played_threshold]
      );
      if (claimed.length === 0) continue; // another request already claimed it

      await grantGamingReward(
        userId,
        { credits: m.reward_credits, xp: m.reward_xp, stars: m.reward_stars },
        "game_play_milestone",
        `milestone:${userId}:${m.games_played_threshold}`
      );
    }
  } catch (err) {
    logger.warn({ userId }, `[games] checkPlayMilestones failed: ${err}`);
  }
}
