/**
 * lib/games/sessions.ts
 *
 * Play-session lifecycle: start a session (issuing a single-use nonce and
 * charging any play cost) and finalize a reported score (validating it,
 * recording the play, granting win rewards, updating the leaderboard and
 * advancing a challenge round when applicable).
 *
 * ANTI-CHEAT (free-tier-friendly, client-reported scores):
 *   - The server issues a single-use nonce on /start; /score consumes it once
 *     (a play row can only be counted a single time).
 *   - The reported score must be a non-negative integer ≤ the game's max_score.
 *   - Elapsed wall time must be ≥ the game's min_play_seconds.
 *   - Reward grants are idempotent via reference_id = play id.
 *   - The score endpoint is additionally rate-limited at the route layer.
 * These are pragmatic guards, not a guarantee; see docs/HOW-IT-WORKS.md.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api/errors";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { grantGamingReward, checkPlayMilestones, type RewardBundle } from "@/lib/games/rewards";
import { updateBestScore } from "@/lib/games/leaderboard";
import { recordChallengeRoundPlay } from "@/lib/games/challenges";
import { getGamesConfig } from "@/lib/games/config";
import { logger } from "@/lib/logger";
import type { GameConfigRow } from "@/lib/games/repo";

export interface StartedSession {
  playId: string;
  nonce: string;
  costCredits: number;
  costStars: number;
}

/**
 * Open a play session for a user on a game. Charges the per-play cost (credits
 * / stars) unless this is a challenge round play. Returns the play id + nonce
 * the client echoes back on /score.
 */
export async function startPlaySession(
  userId: string,
  game: GameConfigRow,
  challengeRoundId?: string | null
): Promise<StartedSession> {
  const nonce = randomUUID();
  const isChallenge = !!challengeRoundId;
  const costCredits = isChallenge ? 0 : game.play_cost_credits;
  const costStars = isChallenge ? 0 : game.play_cost_stars;

  return db.transaction(async (tx) => {
    if (costCredits > 0) {
      await debitCoins(
        userId,
        costCredits,
        "game_play_cost",
        `play_cost:${nonce}`,
        `Play cost: ${game.name}`,
        { gameId: game.id },
        tx
      );
    }
    if (costStars > 0) {
      await debitStars(
        userId,
        costStars,
        "game_play_cost",
        `play_cost:${nonce}`,
        `Play cost: ${game.name}`,
        tx
      );
    }

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO game_plays (game_id, user_id, session_nonce, challenge_round_id, started_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [game.id, userId, nonce, challengeRoundId ?? null]
    );

    return { playId: rows[0].id, nonce, costCredits, costStars };
  });
}

export interface FinalizeResult {
  counted: boolean;
  score: number;
  isWin: boolean;
  isNewBest: boolean;
  reward: RewardBundle;
  challengeRoundId: string | null;
}

interface PlayRow {
  id: string;
  game_id: string;
  user_id: string;
  counted: boolean;
  challenge_round_id: string | null;
  started_at: string;
}

/**
 * Finalize a reported score for a previously-started session.
 * Validates, records the play, grants rewards (for non-challenge personal
 * bests), updates the leaderboard, evaluates play milestones and advances a
 * challenge round when applicable.
 */
export async function finalizeScore(
  userId: string,
  nonce: string,
  rawScore: number,
  game: GameConfigRow
): Promise<FinalizeResult> {
  const score = Math.floor(rawScore);
  if (!Number.isFinite(score) || score < 0) {
    throw badRequest("Invalid score.");
  }
  if (game.max_score != null && score > game.max_score) {
    throw badRequest("Reported score exceeds the allowed maximum for this game.");
  }

  // Load the play by nonce and confirm ownership + un-counted state.
  const { rows: playRows } = await db.query<PlayRow>(
    `SELECT id, game_id, user_id, counted, challenge_round_id, started_at
     FROM game_plays
     WHERE session_nonce = $1
     LIMIT 1`,
    [nonce]
  );
  const play = playRows[0];
  if (!play) throw notFound("Play session not found.");
  if (play.user_id !== userId || play.game_id !== game.id) {
    throw badRequest("Play session does not match this game/user.");
  }
  if (play.counted) {
    throw badRequest("This play session has already been scored.");
  }

  // Minimum and maximum play-time sanity checks.
  const elapsedSec = (Date.now() - new Date(play.started_at).getTime()) / 1000;
  if (game.min_play_seconds > 0 && elapsedSec < game.min_play_seconds) {
    throw badRequest("Play session ended too quickly to be valid.");
  }
  // BUG-GAMES-02: reject submissions for sessions older than the configured max age.
  const sessionCfg = await getGamesConfig();
  if (elapsedSec > sessionCfg.maxPlaySessionAgeSeconds) {
    throw badRequest("Play session has expired — please start a new game.");
  }

  const isChallenge = !!play.challenge_round_id;

  let isNewBest = false;
  let isWin = false;
  let reward: RewardBundle = { credits: 0, xp: 0, stars: 0 };

  // Load reward config before the transaction so we don't hold the row lock
  // while doing a network/IO call. We'll decide isWin inside the transaction
  // once we have the atomic best-score check.
  const cfg = sessionCfg;

  await db.transaction(async (tx) => {
    // Mark the play counted (consumes the nonce). Guarded so a concurrent
    // double-submit can't both succeed.
    const { rows: updated } = await tx.query<{ id: string }>(
      `UPDATE game_plays
       SET score = $1, counted = TRUE, ended_at = NOW()
       WHERE id = $2 AND counted = FALSE
       RETURNING id`,
      [score, play.id]
    );
    if (updated.length === 0) {
      throw badRequest("This play session has already been scored.");
    }

    // Personal-best check is inside the transaction so it's atomic with the
    // counted=TRUE mark. Two concurrent plays cannot both see the same stale
    // previousBest and both claim a new-personal-best reward.
    const { rows: bestRows } = await tx.query<{ best_score: number }>(
      `SELECT best_score FROM game_best_scores WHERE game_id = $1 AND user_id = $2 LIMIT 1 FOR UPDATE`,
      [game.id, userId]
    );
    const previousBest = bestRows[0]?.best_score ?? -1;
    isNewBest = score > previousBest;

    // A non-challenge "win" = a new personal best with a positive score.
    isWin = !isChallenge && isNewBest && score > 0;

    await updateBestScore(game.id, userId, score, isWin, tx);

    await tx.query(
      `UPDATE games SET play_count = play_count + 1, updated_at = NOW() WHERE id = $1`,
      [game.id]
    );

    // Standard per-win reward is granted inside the transaction so a failure
    // rolls back the counted flag and reward atomically (no partial-credit risk).
    if (isWin && cfg) {
      const credits = game.reward_credits_per_win || cfg.defaultRewardCredits;
      const xp = game.reward_xp_per_win || cfg.defaultRewardXp;
      const stars = game.reward_stars_per_win;
      reward = await grantGamingReward(
        userId,
        { credits, xp, stars },
        "game_win",
        `play:${play.id}`,
        tx
      );
    }
  });

  // Every counted play contributes to games-played milestones. BUG-GAMES-01:
  // milestone failures must never roll back a successfully-scored play.
  await checkPlayMilestones(userId).catch(
    (err) => logger.error({ err, userId }, '[games] checkPlayMilestones failed')
  );

  // Advance the challenge round (settles the series + wager when both played).
  if (isChallenge && play.challenge_round_id) {
    await recordChallengeRoundPlay(play.challenge_round_id, userId, play.id, score).catch(
      (err) => logger.error({ err, userId, challengeRoundId: play.challenge_round_id }, '[games] recordChallengeRoundPlay failed')
    );
  }

  return {
    counted: true,
    score,
    isWin,
    isNewBest,
    reward,
    challengeRoundId: play.challenge_round_id,
  };
}
