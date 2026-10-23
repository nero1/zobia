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
 *
 * Acceptance debits both participants and opens escrow in one Drizzle transaction.
 */

import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { badRequest, forbidden, notFound, conflict } from "@/lib/api/errors";
import { creditCoins, debitCoins, canAfford } from "@/lib/economy/coins";
import { getGamesConfig } from "@/lib/games/config";
import { getGameById, type GameConfigRow } from "@/lib/games/repo";
import { grantGamingReward } from "@/lib/games/rewards";
import { computeWagerPayout, requiredWins } from "@/lib/games/wager";
import { getManifestValue } from "@/lib/manifest";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";
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
  expires_at: string;
}

function toChallengeRow(r: {
  id: string;
  gameId: string;
  challengerId: string;
  opponentId: string;
  status: string;
  rounds: number;
  wagerCredits: number;
  escrowCredits: number;
  winnerId: string | null;
  expiresAt: Date | string;
}): ChallengeRow {
  return {
    id: r.id,
    game_id: r.gameId,
    challenger_id: r.challengerId,
    opponent_id: r.opponentId,
    status: r.status,
    rounds: r.rounds,
    wager_credits: r.wagerCredits,
    escrow_credits: r.escrowCredits,
    winner_id: r.winnerId,
    expires_at: new Date(r.expiresAt).toISOString(),
  };
}

const challengeColumns = {
  id: schema.gameChallenges.id,
  gameId: schema.gameChallenges.gameId,
  challengerId: schema.gameChallenges.challengerId,
  opponentId: schema.gameChallenges.opponentId,
  status: schema.gameChallenges.status,
  rounds: schema.gameChallenges.rounds,
  wagerCredits: schema.gameChallenges.wagerCredits,
  escrowCredits: schema.gameChallenges.escrowCredits,
  winnerId: schema.gameChallenges.winnerId,
  expiresAt: schema.gameChallenges.expiresAt,
};

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

  const db = await getDb();
  const [opp] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.id, opponentId), sql`${schema.users.deletedAt} IS NULL`, eq(schema.users.isBanned, false)))
    .limit(1);
  if (!opp) throw notFound("Opponent not found.");

  const recentDaysRaw = Number(await getManifestValue("game_challenge_recent_days") ?? 7);
  const recentDays = Number.isFinite(recentDaysRaw) ? Math.max(1, Math.min(365,recentDaysRaw)) : 7;
  const eligible = await db.execute(sql`SELECT 1 FROM users target,users viewer WHERE target.id=${opponentId} AND viewer.id=${challengerId} AND (
    EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.requester_id=viewer.id AND f.addressee_id=target.id) OR (f.addressee_id=viewer.id AND f.requester_id=target.id)))
    OR (viewer.show_online_status=TRUE AND target.show_online_status=TRUE AND target.last_active_at>NOW()-(${recentDays}*INTERVAL '1 day'))
  )`);
  if(!eligible.rows.length) throw forbidden('Choose a friend or an available recent player.','CHALLENGE_OPPONENT_UNAVAILABLE');

  const verification=await db.execute<{score_verification:string}>(sql`SELECT score_verification FROM games WHERE id=${gameId}`);
  if(wagerCredits>0 && (verification.rows[0]?.score_verification!=='server' || !process.env.GAME_RESULT_WEBHOOK_SECRET))throw badRequest("Wagers require a game with trusted server-verified results.","WAGER_REQUIRES_VERIFIED_GAME");

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

  const dailyLimitRaw = Number(await getManifestValue("game_challenge_daily_limit") ?? 10);
  const dailyLimit = Number.isFinite(dailyLimitRaw) ? Math.max(0, Math.floor(dailyLimitRaw)) : 10;
  const challengeId = await db.transaction(async (tx) => {
    // Serialize creation for a single sender across tabs/workers; no Redis call.
    await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, challengerId)).for("update");
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.gameChallenges)
      .where(and(eq(schema.gameChallenges.challengerId, challengerId), sql`${schema.gameChallenges.createdAt} >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`));
    if (usage.count >= dailyLimit) throw forbidden("You have reached your daily challenge limit.", "CHALLENGE_DAILY_LIMIT");
    const [created] = await tx.insert(schema.gameChallenges).values({
      gameId, challengerId, opponentId, status: "pending", rounds, wagerCredits,
      expiresAt: sql`NOW() + (${expiryHours} * INTERVAL '1 hour')`,
    }).returning({ id: schema.gameChallenges.id });
    return created.id;
  });
  void triggerActivityQuestProgress(challengerId, "challenge_send", db).catch((err) => logger.warn({ err }, "Challenge quest progress failed"));

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
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const row = await lockChallenge(tx, challengeId);
    if (row.opponent_id !== userId) throw forbidden("Only the challenged player can accept.");
    if (row.status !== "pending" || new Date(row.expires_at).getTime() <= Date.now()) {
      throw conflict("This challenge has expired or can no longer be accepted.");
    }
    // Ledger debits and escrow transition share the row lock and transaction.
    // Deterministic account ordering prevents reciprocal challenges deadlocking.
    if (row.wager_credits > 0) {
      const verified=await tx.execute<{score_verification:string}>(sql`SELECT score_verification FROM games WHERE id=${row.game_id} FOR SHARE`);
      if(verified.rows[0]?.score_verification!=='server' || !process.env.GAME_RESULT_WEBHOOK_SECRET)throw badRequest("Wagers require trusted server-verified results.","WAGER_REQUIRES_VERIFIED_GAME");
      for (const participant of [row.challenger_id, row.opponent_id].sort()) {
        await debitCoins(participant, row.wager_credits, "game_wager",
          `chal:${row.id}:stake:${participant}`, "Challenge wager stake", { challengeId: row.id }, tx);
      }
    }
    await tx.update(schema.gameChallenges)
      .set({ status: "active", escrowCredits: row.wager_credits * 2 })
      .where(eq(schema.gameChallenges.id, row.id));
    await tx.insert(schema.gameChallengeRounds)
      .values({ challengeId: row.id, roundNo: 1, status: "pending" })
      .onConflictDoNothing({ target: [schema.gameChallengeRounds.challengeId, schema.gameChallengeRounds.roundNo] });
  });
  await triggerActivityQuestProgress(userId, "challenge_accept", orm).catch((err) => logger.warn({ err }, "Challenge quest progress failed"));
  await notifyChallengeParticipants(challengeId, "game_challenge_accepted");
}

export async function declineChallenge(challengeId: string, userId: string): Promise<void> {
  const orm = await getDb();
  let challengerId: string | undefined;
  await orm.transaction(async (tx) => {
    const c = await lockChallenge(tx, challengeId);
    if (c.opponent_id !== userId) throw forbidden("Only the challenged player can decline.");
    if (c.status !== "pending") throw conflict("This challenge can no longer be declined.");
    challengerId = c.challenger_id;
    await tx.update(schema.gameChallenges).set({ status: "declined" }).where(eq(schema.gameChallenges.id, c.id));
  });
  if (challengerId) {
    await notify(challengerId, "game_challenge_declined", { challengeId });
  }
}

export async function cancelChallenge(challengeId: string, userId: string): Promise<void> {
  let escrowResult: CancelEscrowResult = { challRefund: 0, oppRefund: 0, challForfeitCoins: 0 };
  let challengerIdForNotify = "";
  let opponentIdForNotify = "";

  const orm = await getDb();
  const c = await orm.transaction(async (tx) => {
    const row = await lockChallenge(tx, challengeId);
    if (row.challenger_id !== userId) throw forbidden("Only the challenger can cancel.");
    if (row.status !== "pending" && row.status !== "active") {
      throw conflict("This challenge can no longer be cancelled.");
    }
    if (row.status === "active" && row.escrow_credits > 0) escrowResult = await cancelEscrow(row, tx);
    await tx.update(schema.gameChallenges).set({ status: "cancelled" }).where(eq(schema.gameChallenges.id, row.id));
    return row;
  });
  challengerIdForNotify = c.challenger_id;
  opponentIdForNotify = c.opponent_id;


  // Include forfeiture breakdown in cancellation notification metadata (BUG-CHALLENGE-01)
  const cancelPayload = {
    challengeId,
    challForfeitCoins: escrowResult.challForfeitCoins,
    challRefund: escrowResult.challRefund,
    oppRefund: escrowResult.oppRefund,
  };
  await notify(challengerIdForNotify, "game_challenge_cancelled", cancelPayload).catch(() => {});
  await notify(opponentIdForNotify, "game_challenge_cancelled", cancelPayload).catch(() => {});
}

/**
 * Delete a pending challenge that the opponent has not yet responded to.
 * Only the challenger can delete it, and only while it's still 'pending' —
 * nothing is escrowed at that point, so there's nothing to refund. Once the
 * opponent accepts (status becomes 'active') this is no longer allowed; use
 * cancelChallenge instead, which handles the escrow/forfeit logic.
 */
export async function deletePendingChallenge(challengeId: string, userId: string): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const c = await lockChallenge(tx, challengeId);
    if (c.challenger_id !== userId) throw forbidden("Only the challenger can delete this challenge.");
    if (c.status !== "pending") {
      throw conflict("Only a challenge the opponent hasn't responded to yet can be deleted.");
    }
    await tx.update(schema.gameChallenges).set({ status: "cancelled", challengerArchivedAt: new Date() }).where(eq(schema.gameChallenges.id, c.id));
  });
}

/**
 * Archive a completed challenge — hides it from the default inbox view
 * without touching the wager/prize ledger rows (unlike delete, which is only
 * ever allowed pre-acceptance). Either participant can archive their own view.
 */
export async function archiveChallenge(challengeId: string, userId: string): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const c = await lockChallenge(tx, challengeId);
    if (c.challenger_id !== userId && c.opponent_id !== userId) {
      throw forbidden("You are not part of this challenge.");
    }
    if (c.status !== "completed") {
      throw conflict("Only a completed challenge can be archived.");
    }
    await tx.update(schema.gameChallenges).set(c.challenger_id === userId ? { challengerArchivedAt: new Date() } : { opponentArchivedAt: new Date() }).where(eq(schema.gameChallenges.id, c.id));
  });
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
  // BUG-GAMES-03: reject play attempts on challenges that have passed their expiry
  // even if the expiry cron has not yet run to flip the status to 'expired'.
  if (new Date(c.expires_at) < new Date()) {
    throw conflict("This challenge has expired.");
  }

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
  const orm = await getDb();

  // Returned (not assigned to an outer `let`) because TS's control-flow
  // narrowing does not reliably track reassignment of an outer variable from
  // inside an awaited async closure — a `let` here previously narrowed to
  // `never` at the `if (toSettle)` check below despite the runtime value
  // being correct.
  const toSettle = await orm.transaction(async (tx): Promise<{ c: ChallengeRow; winnerId: string | null } | null> => {
    const [round] = await tx
      .select({
        id: schema.gameChallengeRounds.id,
        challengeId: schema.gameChallengeRounds.challengeId,
        roundNo: schema.gameChallengeRounds.roundNo,
        challengerScore: schema.gameChallengeRounds.challengerScore,
        opponentScore: schema.gameChallengeRounds.opponentScore,
        status: schema.gameChallengeRounds.status,
      })
      .from(schema.gameChallengeRounds)
      .where(eq(schema.gameChallengeRounds.id, roundId))
      .for("update");
    if (!round) return null;

    const c = await lockChallenge(tx, round.challengeId);
    if(userId!==c.challenger_id && userId!==c.opponent_id)throw forbidden('Not a participant');
    if(c.status!=='active')return null;
    if(round.status==='complete')return maybeSettleSeries(tx,c);
    const isChallenger = c.challenger_id === userId;

    // Ignore a second submission for the same side in this round.
    if (isChallenger && round.challengerScore != null) return null;
    if (!isChallenger && round.opponentScore != null) return null;

    if (isChallenger) {
      await tx
        .update(schema.gameChallengeRounds)
        .set({ challengerPlayId: playId, challengerScore: BigInt(score) })
        .where(eq(schema.gameChallengeRounds.id, roundId));
    } else {
      await tx
        .update(schema.gameChallengeRounds)
        .set({ opponentPlayId: playId, opponentScore: BigInt(score) })
        .where(eq(schema.gameChallengeRounds.id, roundId));
    }

    const challengerScore = isChallenger ? score : round.challengerScore != null ? Number(round.challengerScore) : null;
    const opponentScore = isChallenger ? (round.opponentScore != null ? Number(round.opponentScore) : null) : score;

    // Round only resolves once both sides have a score.
    if (challengerScore == null || opponentScore == null) return null;

    let roundWinner: string | null = null;
    if (challengerScore > opponentScore) roundWinner = c.challenger_id;
    else if (opponentScore > challengerScore) roundWinner = c.opponent_id;

    await tx
      .update(schema.gameChallengeRounds)
      .set({ roundWinnerId: roundWinner, status: "complete" })
      .where(eq(schema.gameChallengeRounds.id, roundId));

    return await maybeSettleSeries(tx, c);
  });

  if (toSettle) {
    await settleSeries(toSettle.c, toSettle.winnerId);
  }
}

// ─── Series resolution ───────────────────────────────────────────────────────

/**
 * Tallies round wins and either returns settlement info (caller settles
 * post-commit, since settlement involves out-of-scope coins.ts/rewards.ts
 * calls — see file-level note) or opens the next round.
 */
async function maybeSettleSeries(
  tx: DbOrTx,
  c: ChallengeRow
): Promise<{ c: ChallengeRow; winnerId: string | null } | null> {
  const required = requiredWins(c.rounds);

  const [tally] = await tx
    .select({
      challengerWins: sql<number>`COUNT(*) FILTER (WHERE ${schema.gameChallengeRounds.roundWinnerId} = ${c.challenger_id})::int`,
      opponentWins: sql<number>`COUNT(*) FILTER (WHERE ${schema.gameChallengeRounds.roundWinnerId} = ${c.opponent_id})::int`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${schema.gameChallengeRounds.status} = 'complete')::int`,
    })
    .from(schema.gameChallengeRounds)
    .where(eq(schema.gameChallengeRounds.challengeId, c.id));
  const { challengerWins: cw, opponentWins: ow, completed } = tally;

  if (cw >= required) return { c, winnerId: c.challenger_id };
  if (ow >= required) return { c, winnerId: c.opponent_id };

  // Not yet decided. Open the next round if the series can still be won;
  // a hard cap guards against pathological all-draw series.
  const HARD_CAP = c.rounds + 4;
  if (completed >= HARD_CAP) {
    return { c, winnerId: null }; // unresolved draw → refund
  }
  const nextRoundNo = completed + 1;
  await tx
    .insert(schema.gameChallengeRounds)
    .values({ challengeId: c.id, roundNo: nextRoundNo, status: "pending" })
    .onConflictDoNothing({
      target: [schema.gameChallengeRounds.challengeId, schema.gameChallengeRounds.roundNo],
    });
  return null;
}

async function settleSeries(
  pending: ChallengeRow,
  winnerId: string | null
): Promise<void> {
  const game = await getGameById(pending.game_id);
  const cfg = await getGamesConfig();
  const orm = await getDb();
  const settled = await orm.transaction(async (tx) => {
  const c = await lockChallenge(tx, pending.id);
  if (c.status !== "active") return false;
  // Serialize wallet locks in the same order as acceptance/cancellation.
  for (const participant of [c.challenger_id, c.opponent_id].sort()) await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, participant)).for("update");
  let prizeCredits = 0;
  let prizeXp = 0;
  let prizeStars = 0;


  if (winnerId && c.escrow_credits > 0) {
    const payout = computeWagerPayout(c.escrow_credits, cfg.wagerRakePct);
    if (payout > 0) {
      const payoutDescription = game ? `Challenge wager payout: ${game.name}` : "Challenge wager payout";
      await creditCoins(winnerId, payout, "game_payout", `chal:${c.id}:payout`,
        payoutDescription, { challengeId: c.id }, tx);
      prizeCredits += payout;
    }
  } else if (!winnerId && c.escrow_credits > 0) {
    // Draw: refund both stakes.
    await refundEscrow(c, tx);
  }

  // Award the game's per-win reward bundle to the series winner as the prize.
  if (winnerId && game && game.score_verification==='server' && process.env.GAME_RESULT_WEBHOOK_SECRET) {
    const bundle = await grantGamingReward(
      winnerId,
      {
        credits: game.reward_credits_per_win,
        xp: game.reward_xp_per_win,
        stars: game.reward_stars_per_win,
      },
      "game_challenge_win",
      `chal:${c.id}:prize`,
      tx,
      game.name
    );
    prizeCredits += bundle.credits;
    prizeXp += bundle.xp;
    prizeStars += bundle.stars;
  }

  await tx
    .update(schema.gameChallenges)
    .set({
      status: "completed",
      escrowCredits: 0,
      winnerId,
      completedAt: new Date(),
      prizeCredits,
      prizeXp,
      prizeStars,
    })
    .where(eq(schema.gameChallenges.id, c.id));

  return true;
  });
  if (!settled) return;
  if (winnerId && game?.score_verification==='server' && !!process.env.GAME_RESULT_WEBHOOK_SECRET) await triggerActivityQuestProgress(winnerId, "challenge_win", orm);

  // Notify both participants outside the lock (best-effort).
  notify(pending.challenger_id, "game_challenge_completed", { challengeId: pending.id, winnerId }).catch(() => {});
  notify(pending.opponent_id, "game_challenge_completed", { challengeId: pending.id, winnerId }).catch(() => {});
}

// ─── Expiry sweep (cron) ─────────────────────────────────────────────────────

/** Expire stale challenges and refund any escrow. Returns count expired. */
export async function expireChallenges(): Promise<number> {
  const orm = await getDb();
  const rows = await orm
    .select({ id: schema.gameChallenges.id })
    .from(schema.gameChallenges)
    .where(and(or(inArray(schema.gameChallenges.status, ["pending", "active"]), and(eq(schema.gameChallenges.status, "expired"), sql`${schema.gameChallenges.escrowCredits} > 0`)), or(lt(schema.gameChallenges.expiresAt, sql`NOW()`),sql`(${schema.gameChallenges.escrowCredits}>0 AND EXISTS(SELECT 1 FROM games g WHERE g.id=${schema.gameChallenges.gameId} AND g.score_verification<>'server'))`)))
    .limit(200);

  let count = 0;
  for (const { id } of rows) {
    try {
      const c = await orm.transaction(async (tx) => {
        const row = await lockChallenge(tx, id);
        if (row.status !== "pending" && row.status !== "active" && !(row.status === "expired" && row.escrow_credits > 0)) return null;
        if (row.escrow_credits > 0) await refundEscrow(row, tx);
        await tx.update(schema.gameChallenges).set({ status: "expired" }).where(eq(schema.gameChallenges.id, row.id));
        return row;
      });
      if (!c) continue;
      count++;
    } catch (err) {
      logger.warn({ challengeId: id }, `[games] expireChallenges failed: ${err}`);
    }
  }
  return count;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function lockChallenge(tx: DbOrTx, id: string): Promise<ChallengeRow> {
  const [row] = await tx
    .select(challengeColumns)
    .from(schema.gameChallenges)
    .where(eq(schema.gameChallenges.id, id))
    .for("update");
  if (!row) throw notFound("Challenge not found.");
  return toChallengeRow(row);
}

async function getChallengeRow(id: string): Promise<ChallengeRow | null> {
  const db = await getDb();
  const [row] = await db
    .select(challengeColumns)
    .from(schema.gameChallenges)
    .where(eq(schema.gameChallenges.id, id))
    .limit(1);
  return row ? toChallengeRow(row) : null;
}

/** The round the user still needs to play (both un-scored for that side). */
async function getActiveRoundForUser(
  c: ChallengeRow,
  userId: string
): Promise<{ id: string } | null> {
  const db = await getDb();
  const isChallenger = c.challenger_id === userId;
  const [row] = await db
    .select({ id: schema.gameChallengeRounds.id })
    .from(schema.gameChallengeRounds)
    .where(
      and(
        eq(schema.gameChallengeRounds.challengeId, c.id),
        eq(schema.gameChallengeRounds.status, "pending"),
        isChallenger
          ? sql`${schema.gameChallengeRounds.challengerScore} IS NULL`
          : sql`${schema.gameChallengeRounds.opponentScore} IS NULL`
      )
    )
    .orderBy(sql`${schema.gameChallengeRounds.roundNo} ASC`)
    .limit(1);
  return row ?? null;
}

async function refundEscrow(c: ChallengeRow, tx?: DbOrTx): Promise<void> {
  if (c.wager_credits <= 0) return;
  if (tx) for (const id of [c.challenger_id, c.opponent_id].sort()) await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)).for("update");
  await creditCoins(c.challenger_id, c.wager_credits, "game_refund",
    `chal:${c.id}:refund:${c.challenger_id}`, "Challenge wager refund", { challengeId: c.id }, tx);
  await creditCoins(c.opponent_id, c.wager_credits, "game_refund",
    `chal:${c.id}:refund:${c.opponent_id}`, "Challenge wager refund", { challengeId: c.id }, tx);
  const orm = tx ?? await getDb();
  await orm.update(schema.gameChallenges).set({ escrowCredits: 0 }).where(eq(schema.gameChallenges.id, c.id));
}

/**
 * Compute partial refund when the challenger cancels an active challenge.
 * If no rounds have been completed yet, both players receive a full refund.
 * Otherwise the challenger forfeits a fraction of their stake proportional to
 * the opponent's share of completed-round wins — preventing a losing player
 * from cancelling to recoup a wager they should have lost.
 */
interface CancelEscrowResult {
  challRefund: number;
  oppRefund: number;
  challForfeitCoins: number;
}

async function cancelEscrow(c: ChallengeRow, tx?: DbOrTx): Promise<CancelEscrowResult> {
  if (c.wager_credits <= 0) return { challRefund: 0, oppRefund: 0, challForfeitCoins: 0 };

  const orm = tx ?? await getDb();
  if (tx) for (const id of [c.challenger_id, c.opponent_id].sort()) await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)).for("update");
  const [tally] = await orm
    .select({
      roundsPlayed: sql<number>`COUNT(*) FILTER (WHERE ${schema.gameChallengeRounds.status} = 'complete')::int`,
      challengerWins: sql<number>`COUNT(*) FILTER (WHERE ${schema.gameChallengeRounds.roundWinnerId} = ${c.challenger_id})::int`,
      opponentWins: sql<number>`COUNT(*) FILTER (WHERE ${schema.gameChallengeRounds.roundWinnerId} = ${c.opponent_id})::int`,
    })
    .from(schema.gameChallengeRounds)
    .where(eq(schema.gameChallengeRounds.challengeId, c.id));

  const { roundsPlayed, challengerWins, opponentWins } = tally;
  const decisiveRounds = challengerWins + opponentWins;

  // No rounds played or all draws — full refund, no penalty
  if (roundsPlayed === 0 || decisiveRounds === 0) {
    await refundEscrow(c, tx);
    return { challRefund: c.wager_credits, oppRefund: c.wager_credits, challForfeitCoins: 0 };
  }

  // Challenger forfeits a fraction of their stake equal to their round-win deficit.
  // e.g. challenger 0 wins / 2 decisive → forfeit 100% of their stake to opponent.
  const challForfeitCoins = Math.floor(c.wager_credits * opponentWins / decisiveRounds);
  const challRefund = c.wager_credits - challForfeitCoins;
  const oppRefund = c.wager_credits + challForfeitCoins;

  if (challRefund > 0) {
    await creditCoins(c.challenger_id, challRefund, "game_refund",
      `chal:${c.id}:refund:${c.challenger_id}`, "Challenge wager partial refund (cancelled)", { challengeId: c.id }, tx);
  }
  if (oppRefund > 0) {
    await creditCoins(c.opponent_id, oppRefund, "game_refund",
      `chal:${c.id}:refund:${c.opponent_id}`, "Challenge wager refund + cancellation penalty", { challengeId: c.id }, tx);
  }
  await orm.update(schema.gameChallenges).set({ escrowCredits: 0 }).where(eq(schema.gameChallenges.id, c.id));

  return { challRefund, oppRefund, challForfeitCoins };
}

const CHALLENGE_NOTIFICATION_COPY: Record<string, { title: string; body: string }> = {
  game_challenge_received:  { title: "New Challenge!", body: "You've been challenged to a game." },
  game_challenge_accepted:  { title: "Challenge Accepted", body: "Your challenge has been accepted. Game on!" },
  game_challenge_declined:  { title: "Challenge Declined", body: "Your challenge was declined." },
  game_challenge_cancelled: { title: "Challenge Cancelled", body: "The challenge has been cancelled." },
  game_challenge_completed: { title: "Challenge Complete", body: "The challenge has ended. Check your results!" },
  game_challenge_expired:   { title: "Challenge Expired", body: "A pending challenge has expired." },
};

async function notify(
  userId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  const copy = CHALLENGE_NOTIFICATION_COPY[type] ?? { title: "Game Update", body: "Your challenge status has changed." };
  const db = await getDb();
  await db
    .insert(schema.notifications)
    .values({ userId, type, title: copy.title, body: copy.body, metadata: payload, isRead: false })
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
  archivedAt: string | null;
}

export interface ChallengesPage {
  challenges: ChallengeListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * List challenges for a user with cursor-based pagination (BUG-PAGINATE-01).
 * Uses a composite (created_at, id) keyset cursor to guarantee stable ordering
 * even when multiple challenges share the same created_at timestamp.
 *
 * Cursor format: "<ISO timestamp>|<uuid>" — opaque to callers.
 *
 * @param userId  - UUID of the user
 * @param cursor  - Opaque cursor from the previous page
 * @param limit   - Page size (default 20, max 100)
 */
export async function listUserChallenges(
  userId: string,
  cursor?: string | null,
  limit = 20,
  includeArchived = false,
  statusFilter?: "active" | "expired" | "archived" | "completed"
): Promise<ChallengesPage> {
  const pageSize = Math.min(Math.max(1, Number.isFinite(limit) ? limit : 20), 100);
  const db = await getDb();

  const conditions = [
    or(eq(schema.gameChallenges.challengerId, userId), eq(schema.gameChallenges.opponentId, userId)),
  ];
  if (statusFilter === "archived") conditions.push(sql`(CASE WHEN ${schema.gameChallenges.challengerId} = ${userId} THEN ${schema.gameChallenges.challengerArchivedAt} ELSE ${schema.gameChallenges.opponentArchivedAt} END) IS NOT NULL`);
  if (statusFilter === "completed") conditions.push(eq(schema.gameChallenges.status, "completed"));
  if (statusFilter === "active") conditions.push(sql`${schema.gameChallenges.status} IN ('pending', 'active') AND ${schema.gameChallenges.expiresAt} > NOW()`);
  if (statusFilter === "expired") conditions.push(sql`(${schema.gameChallenges.status} = 'expired' OR (${schema.gameChallenges.status} IN ('pending', 'active') AND ${schema.gameChallenges.expiresAt} <= NOW()))`);
  if (!includeArchived && statusFilter !== "archived") {
    conditions.push(sql`(CASE WHEN ${schema.gameChallenges.challengerId} = ${userId} THEN ${schema.gameChallenges.challengerArchivedAt} ELSE ${schema.gameChallenges.opponentArchivedAt} END) IS NULL`);
  }
  if (cursor) {
    const [cursorTs, cursorId] = cursor.split("|");
    if (cursorTs && cursorId) {
      // Composite keyset: rows strictly older than (created_at, id) of the last seen row.
      // The tie-break on id (descending UUID) ensures deterministic paging when timestamps collide.
      conditions.push(
        sql`(${schema.gameChallenges.createdAt} < ${cursorTs}::timestamptz
          OR (${schema.gameChallenges.createdAt} = ${cursorTs}::timestamptz AND ${schema.gameChallenges.id} < ${cursorId}::uuid))`
      );
    }
  }

  // Archived challenges (soft-hidden completed challenges) are excluded from
  // the default inbox view. Not exposed as a UI toggle today — the caller
  // would need to explicitly request them.
  const cu = alias(schema.users, "cu");
  const ou = alias(schema.users, "ou");

  const rows = await db
    .select({
      id: schema.gameChallenges.id,
      gameId: schema.gameChallenges.gameId,
      gameSlug: schema.games.slug,
      gameName: schema.games.name,
      challengerId: schema.gameChallenges.challengerId,
      opponentId: schema.gameChallenges.opponentId,
      status: schema.gameChallenges.status,
      rounds: schema.gameChallenges.rounds,
      wagerCredits: schema.gameChallenges.wagerCredits,
      winnerId: schema.gameChallenges.winnerId,
      prizeCredits: schema.gameChallenges.prizeCredits,
      prizeXp: schema.gameChallenges.prizeXp,
      prizeStars: schema.gameChallenges.prizeStars,
      createdAt: schema.gameChallenges.createdAt,
      cursorTime: sql<string>`to_char(${schema.gameChallenges.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      expiresAt: schema.gameChallenges.expiresAt,
      completedAt: schema.gameChallenges.completedAt,
      archivedAt: sql<Date | string | null>`CASE WHEN ${schema.gameChallenges.challengerId} = ${userId} THEN ${schema.gameChallenges.challengerArchivedAt} ELSE ${schema.gameChallenges.opponentArchivedAt} END`,
      challengerUsername: cu.username,
      opponentUsername: ou.username,
    })
    .from(schema.gameChallenges)
    .innerJoin(schema.games, eq(schema.games.id, schema.gameChallenges.gameId))
    .innerJoin(cu, eq(cu.id, schema.gameChallenges.challengerId))
    .innerJoin(ou, eq(ou.id, schema.gameChallenges.opponentId))
    .where(and(...conditions))
    .orderBy(sql`${schema.gameChallenges.createdAt} DESC, ${schema.gameChallenges.id} DESC`)
    .limit(pageSize + 1); // fetch one extra to detect hasMore

  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize).map(mapChallengeRow);
  const lastItem = rows.slice(0, pageSize).at(-1);
  const nextCursor = hasMore && lastItem
    ? `${lastItem.cursorTime}|${lastItem.id}`
    : null;

  return { challenges: page, nextCursor, hasMore };
}

export async function getChallengeDetail(
  challengeId: string,
  userId: string
): Promise<ChallengeListItem & { rounds_detail: unknown[] }> {
  const db = await getDb();
  const cu = alias(schema.users, "cu");
  const ou = alias(schema.users, "ou");
  const [row] = await db
    .select({
      id: schema.gameChallenges.id,
      gameId: schema.gameChallenges.gameId,
      gameSlug: schema.games.slug,
      gameName: schema.games.name,
      challengerId: schema.gameChallenges.challengerId,
      opponentId: schema.gameChallenges.opponentId,
      status: schema.gameChallenges.status,
      rounds: schema.gameChallenges.rounds,
      wagerCredits: schema.gameChallenges.wagerCredits,
      winnerId: schema.gameChallenges.winnerId,
      prizeCredits: schema.gameChallenges.prizeCredits,
      prizeXp: schema.gameChallenges.prizeXp,
      prizeStars: schema.gameChallenges.prizeStars,
      createdAt: schema.gameChallenges.createdAt,
      expiresAt: schema.gameChallenges.expiresAt,
      completedAt: schema.gameChallenges.completedAt,
      archivedAt: sql<Date | string | null>`CASE WHEN ${schema.gameChallenges.challengerId} = ${userId} THEN ${schema.gameChallenges.challengerArchivedAt} ELSE ${schema.gameChallenges.opponentArchivedAt} END`,
      challengerUsername: cu.username,
      opponentUsername: ou.username,
    })
    .from(schema.gameChallenges)
    .innerJoin(schema.games, eq(schema.games.id, schema.gameChallenges.gameId))
    .innerJoin(cu, eq(cu.id, schema.gameChallenges.challengerId))
    .innerJoin(ou, eq(ou.id, schema.gameChallenges.opponentId))
    .where(eq(schema.gameChallenges.id, challengeId))
    .limit(1);
  if (!row) throw notFound("Challenge not found.");
  if (row.challengerId !== userId && row.opponentId !== userId) {
    throw forbidden("You are not part of this challenge.");
  }
  const roundRows = await db
    .select({
      roundNo: schema.gameChallengeRounds.roundNo,
      challengerScore: schema.gameChallengeRounds.challengerScore,
      opponentScore: schema.gameChallengeRounds.opponentScore,
      roundWinnerId: schema.gameChallengeRounds.roundWinnerId,
      status: schema.gameChallengeRounds.status,
    })
    .from(schema.gameChallengeRounds)
    .where(eq(schema.gameChallengeRounds.challengeId, challengeId))
    .orderBy(sql`${schema.gameChallengeRounds.roundNo} ASC`);
  return { ...mapChallengeRow(row), rounds_detail: roundRows };
}

function mapChallengeRow(c: {
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
  createdAt: Date | string;
  expiresAt: Date | string;
  completedAt: Date | string | null;
  archivedAt: Date | string | null;
}): ChallengeListItem {
  return {
    id: c.id,
    gameId: c.gameId,
    gameSlug: c.gameSlug,
    gameName: c.gameName,
    challengerId: c.challengerId,
    challengerUsername: c.challengerUsername,
    opponentId: c.opponentId,
    opponentUsername: c.opponentUsername,
    status: ["pending", "active"].includes(c.status) && new Date(c.expiresAt).getTime() <= Date.now() ? "expired" : c.status,
    rounds: c.rounds,
    wagerCredits: c.wagerCredits,
    winnerId: c.winnerId ?? null,
    prizeCredits: c.prizeCredits,
    prizeXp: c.prizeXp,
    prizeStars: c.prizeStars,
    createdAt: new Date(c.createdAt).toISOString(),
    expiresAt: new Date(c.expiresAt).toISOString(),
    completedAt: c.completedAt ? new Date(c.completedAt).toISOString() : null,
    archivedAt: c.archivedAt ? new Date(c.archivedAt).toISOString() : null,
  };
}

// re-export for callers that import the GameConfigRow type alongside challenges
export type { GameConfigRow };

/** Only terminal challenges with no escrow may be permanently pruned. */
export async function pruneChallenges(): Promise<number> {
  const orm = await getDb();
  const removed = await orm.delete(schema.gameChallenges).where(and(
    sql`${schema.gameChallenges.status} IN ('completed', 'declined', 'cancelled', 'expired')`,
    eq(schema.gameChallenges.escrowCredits, 0),
    sql`COALESCE(${schema.gameChallenges.archivedAt}, ${schema.gameChallenges.completedAt}, ${schema.gameChallenges.expiresAt}) < NOW() - INTERVAL '90 days'`
  )).returning({ id: schema.gameChallenges.id });
  return removed.length;
}
