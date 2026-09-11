/**
 * lib/contentTreasury.ts
 *
 * Generic reward-pot (treasury) mechanic shared by Polls and Quizzes: a
 * content creator (or an admin, on the creator's behalf) funds a Credits pot
 * for one poll or quiz; the first `maxClaimants` distinct users who perform
 * a qualifying claim_type (vote/pass) or share it split the pot evenly. This
 * is the exact mechanic `blog_post_treasuries` implements for blog posts
 * (see lib/blogs/service.ts fundPostTreasury/claimTreasuryReward) — pulled
 * out here as one generic pair of tables/functions (`content_treasuries`,
 * `content_treasury_claims`) instead of duplicating it per content type,
 * since Polls and Quizzes need byte-for-byte the same logic.
 *
 * Callers are responsible for their own feature-flag checks
 * (features.polls/features.quizzes) before calling into this module; this
 * module only checks the monetization sub-flag passed in by the caller.
 */

import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { checkAndDebit, creditCoins } from "@/lib/economy/coins";
import { debitStars, creditStars } from "@/lib/economy/stars";
import type { CoinTransactionType } from "@zobia/types";
import type { StarTransactionType } from "@/lib/economy/stars";
import { badRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

export type TreasuryContentType = "poll" | "quiz" | "room";
export type TreasuryClaimType = "vote" | "share" | "pass" | "gift";
/** Room Custom Rewards (migration 0040) only — polls/quizzes always use "credits". */
export type RewardAction = "credits" | "stars" | "custom_text";

export interface TreasuryState {
  id: string;
  fundedAmount: number;
  remainingAmount: number;
  maxClaimants: number;
  claimantCount: number;
  status: string;
  rewardPerClaimant: number;
}

interface TreasuryRow {
  id: string;
  funded_amount: number;
  remaining_amount: number;
  max_claimants: number;
  claimant_count: number;
  status: string;
  owner_id?: string;
}

function toTreasuryState(row: TreasuryRow): TreasuryState {
  return {
    id: row.id,
    fundedAmount: row.funded_amount,
    remainingAmount: row.remaining_amount,
    maxClaimants: row.max_claimants,
    claimantCount: row.claimant_count,
    status: row.status,
    rewardPerClaimant: row.max_claimants > 0 ? Math.floor(row.funded_amount / row.max_claimants) : 0,
  };
}

export async function getContentTreasury(contentType: TreasuryContentType, contentId: string): Promise<TreasuryState | null> {
  const { rows } = await db.query<TreasuryRow>(
    `SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status
     FROM content_treasuries WHERE content_type = $1 AND content_id = $2 LIMIT 1`,
    [contentType, contentId]
  );
  return rows[0] ? toTreasuryState(rows[0]) : null;
}

/**
 * Fund (or top up) a poll/quiz reward pot. Only the content's creator (or an
 * admin, via `allowAdmin`) may fund it. A top-up adds to funded/remaining
 * amounts and, if maxClaimants is given, replaces it going forward — the
 * per-claim reward for remaining slots is always recomputed from the
 * current funded_amount/max_claimants at claim time.
 */
export async function fundContentTreasury(
  ownerId: string,
  contentType: TreasuryContentType,
  contentId: string,
  amount: number,
  maxClaimants: number,
  fundType: CoinTransactionType
): Promise<TreasuryState> {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Amount must be a positive integer.", "TREASURY_INVALID_AMOUNT");
  if (!Number.isInteger(maxClaimants) || maxClaimants <= 0) throw badRequest("Max claimants must be a positive integer.", "TREASURY_INVALID_MAX_CLAIMANTS");

  const referenceId = `content_treasury_fund:${contentType}:${contentId}:${Date.now()}`;
  const result = await db.transaction(async (tx: TransactionClient) => {
    await checkAndDebit(ownerId, amount, fundType, referenceId, `Funded a ${contentType} reward pot`, { contentType, contentId }, tx);
    const { rows } = await tx.query<TreasuryRow>(
      `INSERT INTO content_treasuries (content_type, content_id, owner_id, funded_amount, remaining_amount, max_claimants)
       VALUES ($1, $2, $3, $4, $4, $5)
       ON CONFLICT (content_type, content_id) DO UPDATE SET
         funded_amount = content_treasuries.funded_amount + $4,
         remaining_amount = content_treasuries.remaining_amount + $4,
         max_claimants = $5,
         status = CASE WHEN content_treasuries.status = 'closed' THEN 'closed' ELSE 'active' END,
         updated_at = NOW()
       RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status`,
      [contentType, contentId, ownerId, amount, maxClaimants]
    );
    return rows[0];
  });

  return toTreasuryState(result);
}

/**
 * Records that `userId` performed `claimType` on the poll/quiz, and pays out
 * the pot's per-claimant reward if a treasury is active and slots remain.
 * No-op (returns null) when there's no active treasury, slots are full, the
 * monetization flag is off, or this user already claimed. Best-effort —
 * callers invoke this after their own write commits and never surface its
 * absence as an error.
 */
export async function claimContentTreasuryReward(
  contentType: TreasuryContentType,
  contentId: string,
  userId: string,
  claimType: TreasuryClaimType,
  claimRewardType: CoinTransactionType,
  monetizationEnabled: boolean
): Promise<{ amount: number } | null> {
  if (!monetizationEnabled) return null;

  return db.transaction(async (tx: TransactionClient) => {
    const { rows: treasuryRows } = await tx.query<TreasuryRow>(
      `SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status, owner_id
       FROM content_treasuries WHERE content_type = $1 AND content_id = $2 FOR UPDATE`,
      [contentType, contentId]
    );
    const treasury = treasuryRows[0];
    if (!treasury || treasury.status !== "active") return null;
    if (treasury.claimant_count >= treasury.max_claimants) return null;
    if (treasury.owner_id === userId) return null; // creator can't claim their own pot

    const rewardPerClaimant = Math.floor(treasury.funded_amount / treasury.max_claimants);
    if (rewardPerClaimant <= 0 || treasury.remaining_amount < rewardPerClaimant) return null;

    const { rowCount } = await tx.query(
      `INSERT INTO content_treasury_claims (treasury_id, user_id, claim_type, amount) VALUES ($1, $2, $3, $4) ON CONFLICT (treasury_id, user_id) DO NOTHING`,
      [treasury.id, userId, claimType, rewardPerClaimant]
    );
    if (!rowCount || rowCount === 0) return null; // already claimed

    const newClaimantCount = treasury.claimant_count + 1;
    const newRemaining = treasury.remaining_amount - rewardPerClaimant;
    const newStatus = newClaimantCount >= treasury.max_claimants || newRemaining < rewardPerClaimant ? "exhausted" : "active";
    await tx.query(
      `UPDATE content_treasuries SET claimant_count = $2, remaining_amount = $3, status = $4, updated_at = NOW() WHERE id = $1`,
      [treasury.id, newClaimantCount, newRemaining, newStatus]
    );

    await creditCoins(userId, rewardPerClaimant, claimRewardType, `content_treasury_claim:${treasury.id}:${userId}`, "Reward pot claim", { contentType, contentId, claimType }, tx);

    return { amount: rewardPerClaimant };
  });
}

// ---------------------------------------------------------------------------
// Room Custom Rewards (migration 0040) — content_type = "room", claim_type = "gift"
// ---------------------------------------------------------------------------

export interface RoomRewardState extends TreasuryState {
  title: string | null;
  rewardAction: RewardAction;
  customInstructions: string | null;
}

interface RoomRewardRow extends TreasuryRow {
  title: string | null;
  reward_action: RewardAction;
  custom_instructions: string | null;
}

function toRoomRewardState(row: RoomRewardRow): RoomRewardState {
  return { ...toTreasuryState(row), title: row.title, rewardAction: row.reward_action, customInstructions: row.custom_instructions };
}

export async function getRoomReward(roomId: string): Promise<RoomRewardState | null> {
  const { rows } = await db.query<RoomRewardRow>(
    `SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status, title, reward_action, custom_instructions
     FROM content_treasuries WHERE content_type = 'room' AND content_id = $1 LIMIT 1`,
    [roomId]
  );
  return rows[0] ? toRoomRewardState(rows[0]) : null;
}

export interface FundRoomRewardParams {
  ownerId: string;
  roomId: string;
  title: string;
  maxClaimants: number;
  rewardAction: RewardAction;
  /** Required (and > 0) for rewardAction "credits"/"stars"; ignored for "custom_text". */
  amount?: number;
  /** Required for rewardAction "custom_text"; ignored otherwise. */
  customInstructions?: string;
}

/**
 * Create or replace a room's single active Custom Reward. Only the room
 * owner may call this (enforced by the caller/route). For "credits"/"stars",
 * debits `amount` from the owner's own balance up front — same "pre-fund the
 * pot" model as fundContentTreasury. For "custom_text" there's no pool to
 * fund; the first `maxClaimants` distinct gift senders each just receive
 * `customInstructions`.
 */
export async function fundRoomReward(params: FundRoomRewardParams): Promise<RoomRewardState> {
  const { ownerId, roomId, title, maxClaimants, rewardAction, amount, customInstructions } = params;

  if (!title.trim()) throw badRequest("Reward title is required.", "ROOM_REWARD_INVALID_TITLE");
  if (!Number.isInteger(maxClaimants) || maxClaimants <= 0) {
    throw badRequest("Max claimants must be a positive integer.", "TREASURY_INVALID_MAX_CLAIMANTS");
  }

  if (rewardAction === "custom_text") {
    if (!customInstructions?.trim()) {
      throw badRequest("Custom unlock instructions are required.", "ROOM_REWARD_INVALID_INSTRUCTIONS");
    }
    const { rows } = await db.query<RoomRewardRow>(
      `INSERT INTO content_treasuries
         (content_type, content_id, owner_id, funded_amount, remaining_amount, max_claimants, reward_action, custom_instructions, title, status)
       VALUES ('room', $1, $2, 0, 0, $3, 'custom_text', $4, $5, 'active')
       ON CONFLICT (content_type, content_id) DO UPDATE SET
         funded_amount = 0, remaining_amount = 0, max_claimants = $3,
         reward_action = 'custom_text', custom_instructions = $4, title = $5,
         claimant_count = 0, status = 'active', updated_at = NOW()
       RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status, title, reward_action, custom_instructions`,
      [roomId, ownerId, maxClaimants, customInstructions.trim(), title.trim()]
    );
    return toRoomRewardState(rows[0]);
  }

  if (!Number.isInteger(amount) || amount === undefined || amount <= 0) {
    throw badRequest("Amount must be a positive integer.", "TREASURY_INVALID_AMOUNT");
  }

  const referenceId = `room_reward_fund:${roomId}:${Date.now()}`;
  const result = await db.transaction(async (tx: TransactionClient) => {
    if (rewardAction === "stars") {
      await debitStars(ownerId, amount, "room_reward_fund", referenceId, "Funded a room reward pot", tx);
    } else {
      await checkAndDebit(ownerId, amount, "room_reward_fund", referenceId, "Funded a room reward pot", { roomId }, tx);
    }
    const { rows } = await tx.query<RoomRewardRow>(
      `INSERT INTO content_treasuries
         (content_type, content_id, owner_id, funded_amount, remaining_amount, max_claimants, reward_action, custom_instructions, title, status)
       VALUES ('room', $1, $2, $3, $3, $4, $5, NULL, $6, 'active')
       ON CONFLICT (content_type, content_id) DO UPDATE SET
         funded_amount = $3, remaining_amount = $3, max_claimants = $4,
         reward_action = $5, custom_instructions = NULL, title = $6,
         claimant_count = 0, status = 'active', updated_at = NOW()
       RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status, title, reward_action, custom_instructions`,
      [roomId, ownerId, amount, maxClaimants, rewardAction, title.trim()]
    );
    return rows[0];
  });

  return toRoomRewardState(result);
}

/** Deactivate a room's Custom Reward without deleting its claim history. */
export async function closeRoomReward(roomId: string): Promise<void> {
  await db.query(
    `UPDATE content_treasuries SET status = 'closed', updated_at = NOW() WHERE content_type = 'room' AND content_id = $1`,
    [roomId]
  );
}

/**
 * Called after a gift-send commits (app/api/economy/gifts/send/route.ts) when
 * the recipient is that room's owner. Best-effort — never surfaces as an
 * error to the gift sender; a missing/exhausted/inactive reward is just a
 * no-op. Returns what to tell the sender they unlocked, or null.
 */
export async function claimRoomRewardOnGift(
  roomId: string,
  userId: string,
  giftId: string
): Promise<{ title: string; rewardAction: RewardAction; amount: number; customInstructions: string | null } | null> {
  return db.transaction(async (tx: TransactionClient) => {
    const { rows } = await tx.query<RoomRewardRow>(
      `SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status, owner_id, title, reward_action, custom_instructions
       FROM content_treasuries WHERE content_type = 'room' AND content_id = $1 FOR UPDATE`,
      [roomId]
    );
    const reward = rows[0];
    if (!reward || reward.status !== "active") return null;
    if (reward.claimant_count >= reward.max_claimants) return null;
    if (reward.owner_id === userId) return null; // owner can't claim their own reward

    let payoutAmount = 0;
    if (reward.reward_action !== "custom_text") {
      payoutAmount = Math.floor(reward.funded_amount / reward.max_claimants);
      if (payoutAmount <= 0 || reward.remaining_amount < payoutAmount) return null;
    }

    const { rowCount } = await tx.query(
      `INSERT INTO content_treasury_claims (treasury_id, user_id, claim_type, amount) VALUES ($1, $2, 'gift', $3) ON CONFLICT (treasury_id, user_id) DO NOTHING`,
      [reward.id, userId, payoutAmount]
    );
    if (!rowCount || rowCount === 0) return null; // already claimed this reward

    const newClaimantCount = reward.claimant_count + 1;
    const newRemaining = reward.remaining_amount - payoutAmount;
    const exhausted =
      newClaimantCount >= reward.max_claimants ||
      (reward.reward_action !== "custom_text" && newRemaining < payoutAmount);
    await tx.query(
      `UPDATE content_treasuries SET claimant_count = $2, remaining_amount = $3, status = $4, updated_at = NOW() WHERE id = $1`,
      [reward.id, newClaimantCount, newRemaining, exhausted ? "exhausted" : "active"]
    );

    if (reward.reward_action === "stars") {
      await creditStars(userId, payoutAmount, "room_reward_claim", `room_reward_claim:${reward.id}:${userId}`, "Room reward claim", tx);
    } else if (reward.reward_action === "credits") {
      await creditCoins(userId, payoutAmount, "room_reward_claim", `room_reward_claim:${reward.id}:${userId}`, "Room reward claim", { roomId }, tx);
    }

    return {
      title: reward.title ?? "Room Reward",
      rewardAction: reward.reward_action,
      amount: payoutAmount,
      customInstructions: reward.reward_action === "custom_text" ? reward.custom_instructions : null,
    };
  }).catch((err) => {
    logger.error({ err, roomId, userId, giftId }, "[contentTreasury] failed to claim room reward on gift");
    return null;
  });
}

/** Records a share event (idempotent per user/content) and attempts a treasury claim. */
export async function recordContentShare(
  contentType: TreasuryContentType,
  contentId: string,
  userId: string,
  claimRewardType: CoinTransactionType,
  monetizationEnabled: boolean,
  onShareCounted: (tx: TransactionClient) => Promise<void>
): Promise<{ rewardClaimed: number | null }> {
  const { rowCount } = await db.query(
    `INSERT INTO content_shares (content_type, content_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [contentType, contentId, userId]
  );
  if (rowCount && rowCount > 0) {
    await db.transaction(async (tx: TransactionClient) => {
      await onShareCounted(tx);
    });
  }

  const claim = await claimContentTreasuryReward(contentType, contentId, userId, "share", claimRewardType, monetizationEnabled).catch((err) => {
    logger.error({ err, contentType, contentId, userId }, "[contentTreasury] failed to claim treasury reward for share");
    return null;
  });

  return { rewardClaimed: claim?.amount ?? null };
}
