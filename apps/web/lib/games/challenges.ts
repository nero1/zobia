/**
 * lib/games/challenges.ts
 *
 * User-vs-user challenge engine (async, score-based).
 *
 * A challenger invites an opponent to play a game best-of-1 or best-of-3, with
 * an optional credit wager. The flow:
 *
 *   create  (pending)  → challenger invites; nothing escrowed yet
 *   accept  (active)   → both stakes escrowed; round 1 created
 *   play rounds        → each player plays the active round; high score wins it
 *   complete           → first to the required wins takes the pot (minus rake)
 *                        plus the game's per-win reward bundle
 *   decline/cancel/expire → escrow (if any) refunded to both
 *
 * Wager escrow and all payouts/refunds are idempotent via reference_id.
 */

import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { badRequest, forbidden, notFound, conflict } from "@/lib/api/errors";
import { creditCoins, debitCoins, canAfford } from "@/lib/economy/coins";
import { getGamesConfig } from "@/lib/games/config";
import { getGameById, type GameConfigRow } from "@/lib/games/repo";
import { grantGamingReward } from "@/lib/games/rewards";
import { computeWagerPayout, requiredWins } from "@/lib/games/wager";
import { logger } from "@/lib/logger";

interface ChallengeRow {
  id: string;
  game_id: string;
  challenger_id: string;
  opponent_id: string;
  status: string;
  rounds: number;
  wager_credits: number;
  escrow_credits: number;
  winner_id: string | null;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createChallenge(params: {
  challengerId: string;
  opponentId: string;
  gameId: string;
  rounds: 1 | 3;
  wagerCredits: number;
}): Promise<{ id: string }> {
  const { challengerId, opponentId, gameId, rounds, wagerCredits } = params;

  if (challengerId === opponentId) throw badRequest("You cannot challenge yourself.");
  if (rounds !== 1 && rounds !== 3) throw badRequest("Rounds must be 1 or 3.");
  if (!Number.isInteger(wagerCredits) || wagerCredits < 0) throw badRequest("Invalid wager.");

  const game = await getGameById(gameId);
  if (!game || !game.is_active) throw notFound("Game not found.");

  const { rows: oppRows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND is_banned = FALSE LIMIT 1`,
    [opponentId]
  );
  if (!oppRows[0]) throw notFound("Opponent not found.");

  // Affordability is re-checked atomically at accept time; this is a fast UX guard.
  if (wagerCredits > 0 && !(await canAfford(challengerId, wagerCredits))) {
    throw badRequest("You do not have enough credits for this wager.", "INSUFFICIENT_BALANCE");
  }

  const cfg = await getGamesConfig();
  const maxWager = cfg.maxWagerCredits ?? 10_000;
  if (wagerCredits > maxWager) {
    throw badRequest(`Wager exceeds the maximum allowed amount of ${maxWager} credits.`, "WAGER_TOO_HIGH");
  }
  const expiryHours = Number(cfg.challengeExpiryHours);
  if (!Number.isFinite(expiryHours) || expiryHours <= 0) {
    throw badRequest("Invalid challenge expiry configuration.");
  }
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO game_challenges
       (game_id, challenger_id, opponent_id, status, rounds, wager_credits, expires_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, NOW() + ($6 * INTERVAL '1 hour'))
     RETURNING id`,
    [gameId, challengerId, opponentId, rounds, wagerCredits, expiryHours]
  );
  const challengeId = rows[0].id;

  await notify(opponentId, "game_challenge_received", {
    challengeId,
    gameId,
    gameName: game.name,
    challengerId,
    rounds,
    wagerCredits,
  });

  return { id: challengeId };
}

// ─── Accept / Decline / Cancel ──────────────────────────────────────────────

export async function acceptChallenge(challengeId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await lockChallenge(tx, challengeId);
    if (c.opponent_id !== userId) throw forbidden("Only the challenged player can accept.");
    if (c.status !== "pending") throw conflict("This challenge can no longer be accepted.");

    let escrow = 0;
    if (c.wager_credits > 0) {
      // Escrow both stakes atomically. If either side cannot pay, the whole
      // transaction rolls back and nobody is charged.
      await debitCoins(c.challenger_id, c.wager_credits, "game_wager",
        `chal:${c.id}:stake:${c.challenger_id}`, "Challenge wager stake", { challengeId: c.id }, tx);
      await debitCoins(c.opponent_id, c.wager_credits, "game_wager",
        `chal:${c.id}:stake:${c.opponent_id}`, "Challenge wager stake", { challengeId: c.id }, tx);
      escrow = c.wager_credits * 2;
    }

    await tx.query(
      `UPDATE game_challenges SET status = 'active', escrow_credits = $1 WHERE id = $2`,
      [escrow, c.id]
    );
    // Create round 1.
    await tx.query(
      `INSERT INTO game_challenge_rounds (challenge_id, round_no, status)
       VALUES ($1, 1, 'pending')
       ON CONFLICT (challenge_id, round_no) DO NOTHING`,
      [c.id]
    );
  });

  await notifyChallengeParticipants(challengeId, "game_challenge_accepted");
}

export async function declineChallenge(challengeId: string, userId: string): Promise<void> {
  let challengerId: string | undefined;
  await db.transaction(async (tx) => {
    const c = await lockChallenge(tx, challengeId);
    if (c.opponent_id !== userId) throw forbidden("Only the challenged player can decline.");
    if (c.status !== "pending") throw conflict("This challenge can no longer be declined.");
    challengerId = c.challenger_id;
    await tx.query(`UPDATE game_challenges SET status = 'declined' WHERE id = $1`, [c.id]);
  });
  if (challengerId) {
    await notify(challengerId, "game_challenge_declined", { challengeId });
  }
}

export async function cancelChallenge(challengeId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await lockChallenge(tx, challengeId);
    if (c.challenger_id !== userId) throw forbidden("Only the challenger can cancel.");
    if (c.status !== "pending" && c.status !== "active") {
      throw conflict("This challenge can no longer be cancelled.");
    }
    if (c.status === "active" && c.escrow_credits > 0) {
      await refundEscrow(tx, c);
    }
    await tx.query(`UPDATE game_challenges SET status = 'cancelled' WHERE id = $1`, [c.id]);
  });
  await notifyChallengeParticipants(challengeId, "game_challenge_cancelled");
}

// ─── Play a round ────────────────────────────────────────────────────────────

/**
 * Resolve the caller's current active round in a challenge and the game to
 * play. The route then opens a play session via startPlaySession(game, roundId)
 * and the normal /score endpoint finalizes it (routing back here via the play's
 * challenge_round_id). Kept import-free of sessions.ts to avoid a cycle.
 */
export async function prepareChallengeRoundPlay(
  challengeId: string,
  userId: string
): Promise<{ game: GameConfigRow; roundId: string }> {
  const c = await getChallengeRow(challengeId);
  if (!c) throw notFound("Challenge not found.");
  if (c.challenger_id !== userId && c.opponent_id !== userId) {
    throw forbidden("You are not part of this challenge.");
  }
  if (c.status !== "active") throw conflict("This challenge is not active.");

  const game = await getGameById(c.game_id);
  if (!game || !game.is_active) throw notFound("Game is unavailable.");

  const round = await getActiveRoundForUser(c, userId);
  if (!round) throw conflict("You have already played all available rounds. Awaiting your opponent.");

  return { game, roundId: round.id };
}

/**
 * Record a finished round play (called by finalizeScore). When both players
 * have played the round, decides the round and advances/settles the series.
 */
export async function recordChallengeRoundPlay(
  roundId: string,
  userId: string,
  playId: string,
  score: number
): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows: roundRows } = await tx.query<{
      id: string;
      challenge_id: string;
      round_no: number;
      challenger_score: number | null;
      opponent_score: number | null;
      status: string;
    }>(
      `SELECT id, challenge_id, round_no, challenger_score, opponent_score, status
       FROM game_challenge_rounds WHERE id = $1 FOR UPDATE`,
      [roundId]
    );
    const round = roundRows[0];
    if (!round || round.status === "complete") return;

    const c = await lockChallenge(tx, round.challenge_id);
    const isChallenger = c.challenger_id === userId;
    const col = isChallenger ? "challenger" : "opponent";

    // Ignore a second submission for the same side in this round.
    if (isChallenger && round.challenger_score != null) return;
    if (!isChallenger && round.opponent_score != null) return;

    await tx.query(
      `UPDATE game_challenge_rounds
       SET ${col}_play_id = $1, ${col}_score = $2
       WHERE id = $3`,
      [playId, score, roundId]
    );

    const challengerScore = isChallenger ? score : round.challenger_score;
    const opponentScore = isChallenger ? round.opponent_score : score;

    // Round only resolves once both sides have a score.
    if (challengerScore == null || opponentScore == null) return;

    let roundWinner: string | null = null;
    if (challengerScore > opponentScore) roundWinner = c.challenger_id;
    else if (opponentScore > challengerScore) roundWinner = c.opponent_id;

    await tx.query(
      `UPDATE game_challenge_rounds SET round_winner_id = $1, status = 'complete' WHERE id = $2`,
      [roundWinner, roundId]
    );

    await maybeSettleSeries(tx, c);
  });
}

// ─── Series resolution ───────────────────────────────────────────────────────

async function maybeSettleSeries(tx: TransactionClient, c: ChallengeRow): Promise<void> {
  const required = requiredWins(c.rounds);

  const { rows: tally } = await tx.query<{
    challenger_wins: number;
    opponent_wins: number;
    completed: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE round_winner_id = $1)::int AS challenger_wins,
       COUNT(*) FILTER (WHERE round_winner_id = $2)::int AS opponent_wins,
       COUNT(*) FILTER (WHERE status = 'complete')::int AS completed
     FROM game_challenge_rounds WHERE challenge_id = $3`,
    [c.challenger_id, c.opponent_id, c.id]
  );
  const { challenger_wins: cw, opponent_wins: ow, completed } = tally[0];

  if (cw >= required) return settleSeries(tx, c, c.challenger_id);
  if (ow >= required) return settleSeries(tx, c, c.opponent_id);

  // Not yet decided. Open the next round if the series can still be won;
  // a hard cap guards against pathological all-draw series.
  const HARD_CAP = c.rounds + 4;
  if (completed >= HARD_CAP) {
    return settleSeries(tx, c, null); // unresolved draw → refund
  }
  const nextRoundNo = completed + 1;
  await tx.query(
    `INSERT INTO game_challenge_rounds (challenge_id, round_no, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (challenge_id, round_no) DO NOTHING`,
    [c.id, nextRoundNo]
  );
}

async function settleSeries(
  tx: TransactionClient,
  c: ChallengeRow,
  winnerId: string | null
): Promise<void> {
  let prizeCredits = 0;
  let prizeXp = 0;
  let prizeStars = 0;

  if (winnerId && c.escrow_credits > 0) {
    const cfg = await getGamesConfig();
    const payout = computeWagerPayout(c.escrow_credits, cfg.wagerRakePct);
    if (payout > 0) {
      await creditCoins(winnerId, payout, "game_payout", `chal:${c.id}:payout`,
        "Challenge wager payout", { challengeId: c.id }, tx);
      prizeCredits += payout;
    }
  } else if (!winnerId && c.escrow_credits > 0) {
    // Draw: refund both stakes.
    await refundEscrow(tx, c);
  }

  // Award the game's per-win reward bundle to the series winner as the prize.
  if (winnerId) {
    const game = await getGameById(c.game_id);
    if (game) {
      const bundle = await grantGamingReward(
        winnerId,
        {
          credits: game.reward_credits_per_win,
          xp: game.reward_xp_per_win,
          stars: game.reward_stars_per_win,
        },
        "game_challenge_win",
        `chal:${c.id}:prize`,
        tx
      );
      prizeCredits += bundle.credits;
      prizeXp += bundle.xp;
      prizeStars += bundle.stars;
    }
  }

  await tx.query(
    `UPDATE game_challenges
     SET status = 'completed', winner_id = $1, completed_at = NOW(),
         prize_credits = $2, prize_xp = $3, prize_stars = $4
     WHERE id = $5`,
    [winnerId, prizeCredits, prizeXp, prizeStars, c.id]
  );

  // Notify both participants outside the lock (best-effort).
  notify(c.challenger_id, "game_challenge_completed", { challengeId: c.id, winnerId }).catch(() => {});
  notify(c.opponent_id, "game_challenge_completed", { challengeId: c.id, winnerId }).catch(() => {});
}

// ─── Expiry sweep (cron) ─────────────────────────────────────────────────────

/** Expire stale challenges and refund any escrow. Returns count expired. */
export async function expireChallenges(): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM game_challenges
     WHERE status IN ('pending','active') AND expires_at < NOW()
     LIMIT 200`
  );
  let count = 0;
  for (const { id } of rows) {
    try {
      await db.transaction(async (tx) => {
        const c = await lockChallenge(tx, id);
        if (c.status !== "pending" && c.status !== "active") return;
        if (c.status === "active" && c.escrow_credits > 0) await refundEscrow(tx, c);
        await tx.query(`UPDATE game_challenges SET status = 'expired' WHERE id = $1`, [c.id]);
        count++;
      });
    } catch (err) {
      logger.warn({ challengeId: id }, `[games] expireChallenges failed: ${err}`);
    }
  }
  return count;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function lockChallenge(tx: TransactionClient, id: string): Promise<ChallengeRow> {
  const { rows } = await tx.query<ChallengeRow>(
    `SELECT id, game_id, challenger_id, opponent_id, status, rounds,
            wager_credits, escrow_credits, winner_id
     FROM game_challenges WHERE id = $1 FOR UPDATE`,
    [id]
  );
  if (!rows[0]) throw notFound("Challenge not found.");
  return rows[0];
}

async function getChallengeRow(id: string): Promise<ChallengeRow | null> {
  const { rows } = await db.query<ChallengeRow>(
    `SELECT id, game_id, challenger_id, opponent_id, status, rounds,
            wager_credits, escrow_credits, winner_id
     FROM game_challenges WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

/** The round the user still needs to play (both un-scored for that side). */
async function getActiveRoundForUser(
  c: ChallengeRow,
  userId: string
): Promise<{ id: string } | null> {
  const sideCol = c.challenger_id === userId ? "challenger_score" : "opponent_score";
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM game_challenge_rounds
     WHERE challenge_id = $1 AND status = 'pending' AND ${sideCol} IS NULL
     ORDER BY round_no ASC LIMIT 1`,
    [c.id]
  );
  return rows[0] ?? null;
}

async function refundEscrow(tx: TransactionClient, c: ChallengeRow): Promise<void> {
  if (c.wager_credits <= 0) return;
  await creditCoins(c.challenger_id, c.wager_credits, "game_refund",
    `chal:${c.id}:refund:${c.challenger_id}`, "Challenge wager refund", { challengeId: c.id }, tx);
  await creditCoins(c.opponent_id, c.wager_credits, "game_refund",
    `chal:${c.id}:refund:${c.opponent_id}`, "Challenge wager refund", { challengeId: c.id }, tx);
  await tx.query(`UPDATE game_challenges SET escrow_credits = 0 WHERE id = $1`, [c.id]);
}

async function notify(
  userId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  await db
    .query(
      `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
       VALUES ($1, $2, $3::jsonb, false, NOW())`,
      [userId, type, JSON.stringify(payload)]
    )
    .catch(() => {});
}

async function notifyChallengeParticipants(challengeId: string, type: string): Promise<void> {
  const c = await getChallengeRow(challengeId);
  if (!c) return;
  await notify(c.challenger_id, type, { challengeId });
  await notify(c.opponent_id, type, { challengeId });
}

// ─── Listing / detail (for the API) ──────────────────────────────────────────

export interface ChallengeListItem {
  id: string;
  gameId: string;
  gameSlug: string;
  gameName: string;
  challengerId: string;
  challengerUsername: string;
  opponentId: string;
  opponentUsername: string;
  status: string;
  rounds: number;
  wagerCredits: number;
  winnerId: string | null;
  prizeCredits: number;
  prizeXp: number;
  prizeStars: number;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export async function listUserChallenges(userId: string): Promise<ChallengeListItem[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT c.id, c.game_id, g.slug AS game_slug, g.name AS game_name,
            c.challenger_id, cu.username AS challenger_username,
            c.opponent_id, ou.username AS opponent_username,
            c.status, c.rounds, c.wager_credits, c.winner_id,
            c.prize_credits, c.prize_xp, c.prize_stars,
            c.created_at, c.expires_at, c.completed_at
     FROM game_challenges c
     JOIN games g ON g.id = c.game_id
     JOIN users cu ON cu.id = c.challenger_id
     JOIN users ou ON ou.id = c.opponent_id
     WHERE c.challenger_id = $1 OR c.opponent_id = $1
     ORDER BY c.created_at DESC
     LIMIT 100`,
    [userId]
  );
  return rows.map(mapChallengeRow);
}

export async function getChallengeDetail(
  challengeId: string,
  userId: string
): Promise<ChallengeListItem & { rounds_detail: unknown[] }> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT c.id, c.game_id, g.slug AS game_slug, g.name AS game_name,
            c.challenger_id, cu.username AS challenger_username,
            c.opponent_id, ou.username AS opponent_username,
            c.status, c.rounds, c.wager_credits, c.winner_id,
            c.prize_credits, c.prize_xp, c.prize_stars,
            c.created_at, c.expires_at, c.completed_at
     FROM game_challenges c
     JOIN games g ON g.id = c.game_id
     JOIN users cu ON cu.id = c.challenger_id
     JOIN users ou ON ou.id = c.opponent_id
     WHERE c.id = $1 LIMIT 1`,
    [challengeId]
  );
  const c = rows[0];
  if (!c) throw notFound("Challenge not found.");
  if (c.challenger_id !== userId && c.opponent_id !== userId) {
    throw forbidden("You are not part of this challenge.");
  }
  const { rows: roundRows } = await db.query(
    `SELECT round_no, challenger_score, opponent_score, round_winner_id, status
     FROM game_challenge_rounds WHERE challenge_id = $1 ORDER BY round_no ASC`,
    [challengeId]
  );
  return { ...mapChallengeRow(c), rounds_detail: roundRows };
}

function mapChallengeRow(c: Record<string, unknown>): ChallengeListItem {
  return {
    id: c.id as string,
    gameId: c.game_id as string,
    gameSlug: c.game_slug as string,
    gameName: c.game_name as string,
    challengerId: c.challenger_id as string,
    challengerUsername: c.challenger_username as string,
    opponentId: c.opponent_id as string,
    opponentUsername: c.opponent_username as string,
    status: c.status as string,
    rounds: c.rounds as number,
    wagerCredits: c.wager_credits as number,
    winnerId: (c.winner_id as string | null) ?? null,
    prizeCredits: c.prize_credits as number,
    prizeXp: c.prize_xp as number,
    prizeStars: c.prize_stars as number,
    createdAt: c.created_at as string,
    expiresAt: c.expires_at as string,
    completedAt: (c.completed_at as string | null) ?? null,
  };
}

// re-export for callers that import the GameConfigRow type alongside challenges
export type { GameConfigRow };
