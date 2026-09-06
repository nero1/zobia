/**
 * lib/bbforum/service.ts
 *
 * Old-school BB-style forum — eligibility, thread/reply creation, editing,
 * reactions, and the OP-funded reply "pot"/treasury.
 *
 * Mirrors lib/forum/service.ts (Answers): feature flag → eligibility →
 * level gate → (optional) charge → atomic insert. XP/credit rewards are
 * awarded best-effort AFTER the write transaction commits (via
 * safeAwardXPFireAndForget and a capped creditCoins call) so a reward-award
 * failure never rolls back or blocks the user's post.
 *
 * @module lib/bbforum/service
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { loadManifest, requireFeatureEnabled, type ZobiaManifest } from "@/lib/manifest";
import { getRankForXP } from "@/lib/xp/engine";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { applyBbforumAutoModeration } from "@/lib/bbforum/moderation";
import * as repo from "@/lib/bbforum/repo";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export async function isUserModeratorOrAdmin(userId: string): Promise<boolean> {
  const { rows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
    `SELECT is_admin, is_moderator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  return !!(row?.is_admin || row?.is_moderator);
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface BbforumEligibility {
  rankNumber: number;
  creditBalance: number;
  starBalance: number;
  config: ZobiaManifest["bbforum"];
}

export async function getBbforumEligibility(userId: string): Promise<BbforumEligibility> {
  const [manifest, userRows] = await Promise.all([
    loadManifest(),
    db.query<{ xp_total: number; coin_balance: number; star_balance: number }>(
      `SELECT COALESCE(xp_total, 0) AS xp_total, COALESCE(coin_balance, 0) AS coin_balance, COALESCE(star_balance, 0) AS star_balance
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    ),
  ]);
  const row = userRows.rows[0];
  if (!row) throw forbidden("User account not found");
  return {
    rankNumber: getRankForXP(row.xp_total).rankNumber,
    creditBalance: row.coin_balance,
    starBalance: row.star_balance,
    config: manifest.bbforum,
  };
}

/** Throws a 403 if the user's level is below the configured post/reply threshold. */
export function assertCanPost(eligibility: BbforumEligibility): void {
  if (eligibility.rankNumber < eligibility.config.minLevelToPost) {
    throw forbidden(
      `You must reach Level ${eligibility.config.minLevelToPost} to post in the forum. Your current level is ${eligibility.rankNumber}.`,
      "BBFORUM_LEVEL_TOO_LOW",
      { minLevel: eligibility.config.minLevelToPost, currentLevel: eligibility.rankNumber }
    );
  }
}

/** Throws a structured, client-renderable error if the image cost can't be covered. */
function assertCanAffordImage(eligibility: BbforumEligibility): void {
  const { imageCostCredits, imageCostStars } = eligibility.config;
  if (imageCostCredits > 0 && eligibility.creditBalance < imageCostCredits) {
    throw new ApiError(402, "INSUFFICIENT_BBFORUM_IMAGE_FUNDS", `You need ${imageCostCredits} Credits to attach an image.`, undefined, undefined, { imageCostCredits });
  }
  if (imageCostStars > 0 && eligibility.starBalance < imageCostStars) {
    throw new ApiError(402, "INSUFFICIENT_BBFORUM_IMAGE_FUNDS", `You need ${imageCostStars} Stars to attach an image.`, undefined, undefined, { imageCostStars });
  }
}

async function chargeImageCost(userId: string, config: ZobiaManifest["bbforum"], referenceId: string, tx: TransactionClient): Promise<void> {
  if (config.imageCostCredits > 0) {
    await debitCoins(userId, config.imageCostCredits, "bbforum_image_upload", referenceId, "Attached an image to a forum post", undefined, tx);
  }
  if (config.imageCostStars > 0) {
    await debitStars(userId, config.imageCostStars, "bbforum_image_upload", referenceId, "Attached an image to a forum post", tx);
  }
}

// ---------------------------------------------------------------------------
// Reward helpers (best-effort, run after the write transaction commits)
// ---------------------------------------------------------------------------

async function awardBbforumCreditsCapped(
  userId: string,
  amount: number,
  type: "bbforum_thread_reward" | "bbforum_reply_reward",
  referenceId: string,
  description: string,
  dailyCapCredits: number
): Promise<void> {
  if (amount <= 0) return;
  try {
    const { rows } = await db.query<{ earned: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS earned
       FROM coin_ledger
       WHERE user_id = $1 AND transaction_type LIKE 'bbforum_%' AND amount > 0
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    const earnedToday = parseInt(rows[0]?.earned ?? "0", 10);
    const headroom = dailyCapCredits - earnedToday;
    if (headroom <= 0) return;
    const capped = Math.min(amount, headroom);
    await creditCoins(userId, capped, type, referenceId, description);
  } catch (err) {
    logger.error({ err, userId, type, amount }, "[bbforum/service] reward credit award failed");
  }
}

function awardBbforumRewards(
  userId: string,
  xpAmount: number,
  creditAmount: number,
  xpSource: string,
  creditType: "bbforum_thread_reward" | "bbforum_reply_reward",
  referenceId: string,
  description: string,
  dailyCapCredits: number
): void {
  if (xpAmount > 0) {
    safeAwardXPFireAndForget(userId, xpAmount, "social", xpSource, referenceId);
  }
  if (creditAmount > 0) {
    awardBbforumCreditsCapped(userId, creditAmount, creditType, referenceId, description, dailyCapCredits).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Create thread
// ---------------------------------------------------------------------------

export interface CreateThreadInput {
  userId: string;
  boardSlug: string;
  title: string;
  body: string;
  contentFormat: repo.ContentFormat;
  imageUrl?: string | null;
  /** Credits paid out per claimant from this thread's reply pot. 0 = no pot. */
  potPerClaimCredits?: number;
  /** Max number of repliers who can claim from the pot. */
  potMaxClaims?: number;
}

export async function createThread(input: CreateThreadInput): Promise<{ thread: repo.ThreadRow }> {
  await requireFeatureEnabled("bbforum");

  const board = await repo.getBoardBySlug(input.boardSlug);
  if (!board) throw notFound("Board not found");

  const eligibility = await getBbforumEligibility(input.userId);
  assertCanPost(eligibility);

  if (input.imageUrl) assertCanAffordImage(eligibility);

  const potPerClaim = Math.max(0, Math.floor(input.potPerClaimCredits ?? 0));
  const potMaxClaims = Math.max(0, Math.floor(input.potMaxClaims ?? 0));
  const potTotal = potPerClaim * potMaxClaims;
  if (potTotal > 0 && eligibility.creditBalance < potTotal) {
    throw new ApiError(402, "INSUFFICIENT_BBFORUM_POT_FUNDS", `You need ${potTotal} Credits to fund this pot (${potPerClaim} x ${potMaxClaims} claimants).`, undefined, undefined, { potTotal });
  }

  const mod = eligibility.config.autoModerationEnabled
    ? await applyBbforumAutoModeration({ title: input.title, body: input.body, authorId: input.userId, targetType: "bb_thread" }, db)
    : { blocked: false, filteredTitle: input.title, filteredBody: input.body };

  if (mod.blocked) {
    throw badRequest("This thread looks like a duplicate of one you posted recently.", "BBFORUM_CONTENT_BLOCKED");
  }

  const chargeReference = `bbforum_charge:${input.userId}:${randomUUID()}`;

  const thread = await db.transaction(async (tx: TransactionClient) => {
    if (potTotal > 0) {
      await debitCoins(input.userId, potTotal, "bbforum_pot_fund", chargeReference, `Funded a reply pot (${potPerClaim} Credits x ${potMaxClaims})`, undefined, tx);
    }
    if (input.imageUrl) {
      await chargeImageCost(input.userId, eligibility.config, chargeReference, tx);
    }
    return repo.createThread(
      {
        boardId: board.id,
        authorId: input.userId,
        title: mod.filteredTitle ?? input.title,
        body: mod.filteredBody ?? input.body,
        contentFormat: input.contentFormat,
        imageUrl: input.imageUrl ?? null,
        potPerClaimCredits: potPerClaim,
        potMaxClaims,
      },
      tx
    );
  });

  awardBbforumRewards(
    input.userId,
    eligibility.config.rewardXpPerThread,
    eligibility.config.rewardCreditsPerThread,
    "bbforum_thread_posted",
    "bbforum_thread_reward",
    `bbforum_thread_reward:${thread.id}`,
    "Started a forum thread",
    eligibility.config.dailyRewardCapCredits
  );

  return { thread };
}

// ---------------------------------------------------------------------------
// Create reply
// ---------------------------------------------------------------------------

export interface CreateReplyInput {
  userId: string;
  threadSlug: string;
  body: string;
  contentFormat: repo.ContentFormat;
  imageUrl?: string | null;
  quotedPostId?: string | null;
}

export async function createReply(input: CreateReplyInput): Promise<{ post: repo.PostRow; potClaimedCredits: number }> {
  await requireFeatureEnabled("bbforum");

  const thread = await repo.getThreadBySlug(input.threadSlug);
  if (!thread) throw notFound("Thread not found");

  const eligibility = await getBbforumEligibility(input.userId);
  assertCanPost(eligibility);
  if (input.imageUrl) assertCanAffordImage(eligibility);

  const mod = eligibility.config.autoModerationEnabled
    ? await applyBbforumAutoModeration({ body: input.body, authorId: input.userId, targetType: "bb_post" }, db)
    : { blocked: false, filteredBody: input.body };

  if (mod.blocked) {
    throw badRequest("This reply looks like a duplicate of one you posted recently.", "BBFORUM_CONTENT_BLOCKED");
  }

  if (input.imageUrl) {
    const chargeReference = `bbforum_charge:${input.userId}:${randomUUID()}`;
    await db.transaction((tx) => chargeImageCost(input.userId, eligibility.config, chargeReference, tx));
  }

  const { post, potClaimedCredits } = await repo.createReply({
    threadId: thread.id,
    authorId: input.userId,
    body: mod.filteredBody ?? input.body,
    contentFormat: input.contentFormat,
    imageUrl: input.imageUrl ?? null,
    quotedPostId: input.quotedPostId ?? null,
  });

  awardBbforumRewards(
    input.userId,
    eligibility.config.rewardXpPerReply,
    eligibility.config.rewardCreditsPerReply,
    "bbforum_reply_posted",
    "bbforum_reply_reward",
    `bbforum_reply_reward:${post.id}`,
    "Replied to a forum thread",
    eligibility.config.dailyRewardCapCredits
  );

  if (potClaimedCredits > 0) {
    creditCoins(input.userId, potClaimedCredits, "bbforum_pot_claim", `bbforum_pot_claim:${post.id}`, "Claimed a forum thread's reply pot").catch((err) => {
      logger.error({ err, userId: input.userId, postId: post.id }, "[bbforum/service] pot claim credit failed");
    });
  }

  return { post, potClaimedCredits };
}

// ---------------------------------------------------------------------------
// Edit / delete (author or moderator)
// ---------------------------------------------------------------------------

export async function editPost(postId: string, callerId: string, callerIsModerator: boolean, body: string, contentFormat: repo.ContentFormat): Promise<repo.PostRow> {
  const post = await repo.getPostById(postId);
  if (!post) throw notFound("Post not found");
  if (post.author_id !== callerId && !callerIsModerator) throw forbidden("You can't edit this post.", "BBFORUM_NOT_AUTHOR");
  return repo.updatePostBody(postId, body, contentFormat);
}

export async function deletePost(postId: string, callerId: string, callerIsModerator: boolean): Promise<void> {
  const post = await repo.getPostById(postId);
  if (!post) throw notFound("Post not found");
  if (post.author_id !== callerId && !callerIsModerator) throw forbidden("You can't delete this post.", "BBFORUM_NOT_AUTHOR");
  await repo.deletePost(postId);
}

export async function editThreadTitle(threadId: string, callerId: string, callerIsModerator: boolean, title: string): Promise<repo.ThreadRow> {
  const thread = await repo.getThreadById(threadId);
  if (!thread) throw notFound("Thread not found");
  if (thread.author_id !== callerId && !callerIsModerator) throw forbidden("You can't edit this thread.", "BBFORUM_NOT_AUTHOR");
  return repo.updateThreadTitle(threadId, title);
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export async function reactToPost(postId: string, userId: string, emoji: string) {
  await requireFeatureEnabled("bbforum");
  return repo.toggleReaction(postId, userId, emoji);
}

// ---------------------------------------------------------------------------
// Pot expiry sweep (called from a daily CRON aggregator — see
// app/api/cron/daily-economy/route.ts)
// ---------------------------------------------------------------------------

export async function sweepExpiredPots(): Promise<{ refunded: number; totalCreditsRefunded: number }> {
  const manifest = await loadManifest();
  const candidates = await repo.listExpiredUnclaimedPots(manifest.bbforum.potExpiryDays);
  let refunded = 0;
  let totalCreditsRefunded = 0;
  for (const t of candidates) {
    const unclaimed = t.pot_total_credits - t.pot_per_claim_credits * t.pot_claims_count;
    if (unclaimed <= 0) {
      await repo.markPotRefunded(t.id).catch(() => {});
      continue;
    }
    try {
      await creditCoins(t.author_id, unclaimed, "bbforum_pot_refund", `bbforum_pot_refund:${t.id}`, "Refund of unclaimed forum thread pot balance");
      await repo.markPotRefunded(t.id);
      refunded++;
      totalCreditsRefunded += unclaimed;
    } catch (err) {
      logger.error({ err, threadId: t.id }, "[bbforum/service] pot refund failed");
    }
  }
  return { refunded, totalCreditsRefunded };
}
