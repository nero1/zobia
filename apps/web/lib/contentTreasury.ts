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

import { eq, and, sql as sqlOp } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { checkAndDebit, creditCoins } from "@/lib/economy/coins";
import { debitStars, creditStars } from "@/lib/economy/stars";
import type { CoinTransactionType } from "@zobia/types";
import type { StarTransactionType } from "@/lib/economy/stars";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

export type TreasuryContentType = "poll" | "quiz" | "room" | "wiki";
export type TreasuryClaimType = "vote" | "share" | "pass" | "gift" | "contribute";
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
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.contentTreasuries.id,
      funded_amount: schema.contentTreasuries.fundedAmount,
      remaining_amount: schema.contentTreasuries.remainingAmount,
      max_claimants: schema.contentTreasuries.maxClaimants,
      claimant_count: schema.contentTreasuries.claimantCount,
      status: schema.contentTreasuries.status,
    })
    .from(schema.contentTreasuries)
    .where(and(eq(schema.contentTreasuries.contentType, contentType), eq(schema.contentTreasuries.contentId, contentId)))
    .limit(1);
  return rows[0] ? toTreasuryState(rows[0]) : null;
}

/**
 * Create a poll/quiz/wiki reward pot. Only the content's creator may fund
 * it, and only when no reward pot already exists for it (or an earlier one
 * was turned off — see closeContentTreasury). Once a pot exists, further
 * changes go through editContentTreasury (adjust amount/recipients) or
 * closeContentTreasury (turn it off, refunding unclaimed funds) — a plain
 * re-fund used to additively bump funded_amount while overwriting
 * max_claimants outright, which desynced the per-claimant reward from what
 * earlier claimants had already been paid. Reusing a closed pot's row
 * resets it to a fresh pot (new claimant_count of 0); anyone who claimed
 * the earlier pot is permanently excluded from claiming this one too, since
 * their claim row still occupies the (treasury_id, user_id) uniqueness.
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
  const orm = await getDb();
  const result = await orm.transaction(async (tx) => {
    const existingRows = await tx
      .select({ status: schema.contentTreasuries.status })
      .from(schema.contentTreasuries)
      .where(and(eq(schema.contentTreasuries.contentType, contentType), eq(schema.contentTreasuries.contentId, contentId)))
      .for("update");
    if (existingRows[0] && existingRows[0].status !== "closed") {
      throw badRequest(
        "A reward pot already exists for this content. Edit it or turn it off instead of funding it again.",
        "TREASURY_ALREADY_EXISTS"
      );
    }

    await checkAndDebit(ownerId, amount, fundType, referenceId, `Funded a ${contentType} reward pot`, { contentType, contentId }, tx);
    const rows = await tx
      .insert(schema.contentTreasuries)
      .values({ contentType, contentId, ownerId, fundedAmount: amount, remainingAmount: amount, maxClaimants })
      .onConflictDoUpdate({
        target: [schema.contentTreasuries.contentType, schema.contentTreasuries.contentId],
        set: {
          ownerId,
          fundedAmount: amount,
          remainingAmount: amount,
          maxClaimants,
          claimantCount: 0,
          status: "active",
          updatedAt: sqlOp`NOW()`,
        },
      })
      .returning({
        id: schema.contentTreasuries.id,
        funded_amount: schema.contentTreasuries.fundedAmount,
        remaining_amount: schema.contentTreasuries.remainingAmount,
        max_claimants: schema.contentTreasuries.maxClaimants,
        claimant_count: schema.contentTreasuries.claimantCount,
        status: schema.contentTreasuries.status,
      });
    return rows[0];
  });

  return toTreasuryState(result);
}

/**
 * Edit an existing, still-open reward pot's total amount and/or max
 * claimants. Debits the owner for any increase, refunds any decrease
 * (never below what's already been paid out to claimants), and recomputes
 * remaining_amount/status from the new totals so the per-claimant reward
 * stays consistent with what earlier claimants already received.
 */
export async function editContentTreasury(
  ownerId: string,
  contentType: TreasuryContentType,
  contentId: string,
  newAmount: number,
  newMaxClaimants: number,
  fundType: CoinTransactionType,
  refundType: CoinTransactionType
): Promise<TreasuryState> {
  if (!Number.isInteger(newAmount) || newAmount <= 0) throw badRequest("Amount must be a positive integer.", "TREASURY_INVALID_AMOUNT");
  if (!Number.isInteger(newMaxClaimants) || newMaxClaimants <= 0) {
    throw badRequest("Max claimants must be a positive integer.", "TREASURY_INVALID_MAX_CLAIMANTS");
  }

  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: schema.contentTreasuries.id,
        funded_amount: schema.contentTreasuries.fundedAmount,
        remaining_amount: schema.contentTreasuries.remainingAmount,
        max_claimants: schema.contentTreasuries.maxClaimants,
        claimant_count: schema.contentTreasuries.claimantCount,
        status: schema.contentTreasuries.status,
        owner_id: schema.contentTreasuries.ownerId,
      })
      .from(schema.contentTreasuries)
      .where(and(eq(schema.contentTreasuries.contentType, contentType), eq(schema.contentTreasuries.contentId, contentId)))
      .for("update");
    const treasury = rows[0];
    if (!treasury) throw notFound("Reward pot not found.");
    if (treasury.owner_id !== ownerId) throw forbidden("Only the pot's creator can edit it.");
    if (treasury.status === "closed") throw badRequest("This reward pot is closed. Fund a new one instead.", "TREASURY_CLOSED");

    if (newMaxClaimants < treasury.claimant_count) {
      throw badRequest(
        `Max claimants can't be less than the ${treasury.claimant_count} people who already claimed.`,
        "TREASURY_INVALID_MAX_CLAIMANTS"
      );
    }

    const alreadyPaid = treasury.funded_amount - treasury.remaining_amount;
    if (newAmount < alreadyPaid) {
      throw badRequest(`Amount can't be less than the ${alreadyPaid} already paid out to claimants.`, "TREASURY_INVALID_AMOUNT");
    }

    const delta = newAmount - treasury.funded_amount;
    if (delta > 0) {
      await checkAndDebit(
        ownerId, delta, fundType,
        `content_treasury_edit_debit:${treasury.id}:${Date.now()}`,
        `Increased a ${contentType} reward pot`, { contentType, contentId }, tx
      );
    } else if (delta < 0) {
      await creditCoins(
        ownerId, -delta, refundType,
        `content_treasury_edit_refund:${treasury.id}:${Date.now()}`,
        `Reduced a ${contentType} reward pot`, { contentType, contentId }, tx
      );
    }

    const newRemaining = newAmount - alreadyPaid;
    const rewardPerClaimant = Math.floor(newAmount / newMaxClaimants);
    const newStatus =
      treasury.claimant_count >= newMaxClaimants || rewardPerClaimant <= 0 || newRemaining < rewardPerClaimant
        ? "exhausted"
        : "active";

    const updated = await tx
      .update(schema.contentTreasuries)
      .set({ fundedAmount: newAmount, remainingAmount: newRemaining, maxClaimants: newMaxClaimants, status: newStatus, updatedAt: sqlOp`NOW()` })
      .where(eq(schema.contentTreasuries.id, treasury.id))
      .returning({
        id: schema.contentTreasuries.id,
        funded_amount: schema.contentTreasuries.fundedAmount,
        remaining_amount: schema.contentTreasuries.remainingAmount,
        max_claimants: schema.contentTreasuries.maxClaimants,
        claimant_count: schema.contentTreasuries.claimantCount,
        status: schema.contentTreasuries.status,
      });
    return toTreasuryState(updated[0]);
  });
}

/**
 * Turn off a reward pot: refunds whatever's left unclaimed to the owner's
 * Credits balance and marks it closed. Existing claimants keep what they
 * already received; nobody can claim from this pot again afterward.
 */
export async function closeContentTreasury(
  ownerId: string,
  contentType: TreasuryContentType,
  contentId: string,
  refundType: CoinTransactionType
): Promise<TreasuryState> {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: schema.contentTreasuries.id,
        funded_amount: schema.contentTreasuries.fundedAmount,
        remaining_amount: schema.contentTreasuries.remainingAmount,
        max_claimants: schema.contentTreasuries.maxClaimants,
        claimant_count: schema.contentTreasuries.claimantCount,
        status: schema.contentTreasuries.status,
        owner_id: schema.contentTreasuries.ownerId,
      })
      .from(schema.contentTreasuries)
      .where(and(eq(schema.contentTreasuries.contentType, contentType), eq(schema.contentTreasuries.contentId, contentId)))
      .for("update");
    const treasury = rows[0];
    if (!treasury) throw notFound("Reward pot not found.");
    if (treasury.owner_id !== ownerId) throw forbidden("Only the pot's creator can turn it off.");
    if (treasury.status === "closed") throw badRequest("This reward pot is already off.", "TREASURY_ALREADY_CLOSED");

    if (treasury.remaining_amount > 0) {
      await creditCoins(
        ownerId, treasury.remaining_amount, refundType,
        `content_treasury_close_refund:${treasury.id}`,
        `Reward pot turned off — unclaimed funds refunded`, { contentType, contentId }, tx
      );
    }

    const updated = await tx
      .update(schema.contentTreasuries)
      .set({ remainingAmount: 0, status: "closed", updatedAt: sqlOp`NOW()` })
      .where(eq(schema.contentTreasuries.id, treasury.id))
      .returning({
        id: schema.contentTreasuries.id,
        funded_amount: schema.contentTreasuries.fundedAmount,
        remaining_amount: schema.contentTreasuries.remainingAmount,
        max_claimants: schema.contentTreasuries.maxClaimants,
        claimant_count: schema.contentTreasuries.claimantCount,
        status: schema.contentTreasuries.status,
      });
    return toTreasuryState(updated[0]);
  });
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

  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const treasuryRows = await tx
      .select({
        id: schema.contentTreasuries.id,
        funded_amount: schema.contentTreasuries.fundedAmount,
        remaining_amount: schema.contentTreasuries.remainingAmount,
        max_claimants: schema.contentTreasuries.maxClaimants,
        claimant_count: schema.contentTreasuries.claimantCount,
        status: schema.contentTreasuries.status,
        owner_id: schema.contentTreasuries.ownerId,
      })
      .from(schema.contentTreasuries)
      .where(and(eq(schema.contentTreasuries.contentType, contentType), eq(schema.contentTreasuries.contentId, contentId)))
      .for("update");
    const treasury = treasuryRows[0];
    if (!treasury || treasury.status !== "active") return null;
    if (treasury.claimant_count >= treasury.max_claimants) return null;
    if (treasury.owner_id === userId) return null; // creator can't claim their own pot

    const rewardPerClaimant = Math.floor(treasury.funded_amount / treasury.max_claimants);
    if (rewardPerClaimant <= 0 || treasury.remaining_amount < rewardPerClaimant) return null;

    const insertResult = await tx
      .insert(schema.contentTreasuryClaims)
      .values({ treasuryId: treasury.id, userId, claimType, amount: rewardPerClaimant })
      .onConflictDoNothing({ target: [schema.contentTreasuryClaims.treasuryId, schema.contentTreasuryClaims.userId] });
    if (!insertResult.rowCount || insertResult.rowCount === 0) return null; // already claimed

    const newClaimantCount = treasury.claimant_count + 1;
    const newRemaining = treasury.remaining_amount - rewardPerClaimant;
    const newStatus = newClaimantCount >= treasury.max_claimants || newRemaining < rewardPerClaimant ? "exhausted" : "active";
    await tx
      .update(schema.contentTreasuries)
      .set({ claimantCount: newClaimantCount, remainingAmount: newRemaining, status: newStatus, updatedAt: sqlOp`NOW()` })
      .where(eq(schema.contentTreasuries.id, treasury.id));

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

// NOTE (schema gap): content_treasuries.title / reward_action / custom_instructions
// (migration 0040, Room Custom Rewards) are not modeled in lib/db/schema.ts —
// the Drizzle table only has the generic reward-pot columns. These queries use
// Drizzle's `sql` tagged template (still through the shared getDb()/tx pool,
// still fully parameterised) rather than the query builder until schema.ts is
// updated to include those columns.
export async function getRoomReward(roomId: string): Promise<RoomRewardState | null> {
  const orm = await getDb();
  const result = await orm.execute<RoomRewardRow & Record<string, unknown>>(sqlOp`
    SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status, title, reward_action, custom_instructions
    FROM content_treasuries WHERE content_type = 'room' AND content_id = ${roomId} LIMIT 1
  `);
  const row = result.rows[0];
  return row ? toRoomRewardState(row) : null;
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
    const orm = await getDb();
    const result = await orm.execute<RoomRewardRow & Record<string, unknown>>(sqlOp`
      INSERT INTO content_treasuries
         (content_type, content_id, owner_id, funded_amount, remaining_amount, max_claimants, reward_action, custom_instructions, title, status)
       VALUES ('room', ${roomId}, ${ownerId}, 0, 0, ${maxClaimants}, 'custom_text', ${customInstructions.trim()}, ${title.trim()}, 'active')
       ON CONFLICT (content_type, content_id) DO UPDATE SET
         funded_amount = 0, remaining_amount = 0, max_claimants = ${maxClaimants},
         reward_action = 'custom_text', custom_instructions = ${customInstructions.trim()}, title = ${title.trim()},
         claimant_count = 0, status = 'active', updated_at = NOW()
       RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status, title, reward_action, custom_instructions
    `);
    return toRoomRewardState(result.rows[0]);
  }

  if (!Number.isInteger(amount) || amount === undefined || amount <= 0) {
    throw badRequest("Amount must be a positive integer.", "TREASURY_INVALID_AMOUNT");
  }

  const referenceId = `room_reward_fund:${roomId}:${Date.now()}`;
  const orm = await getDb();
  const result = await orm.transaction(async (tx) => {
    if (rewardAction === "stars") {
      await debitStars(ownerId, amount, "room_reward_fund", referenceId, "Funded a room reward pot", tx);
    } else {
      await checkAndDebit(ownerId, amount, "room_reward_fund", referenceId, "Funded a room reward pot", { roomId }, tx);
    }
    const insertResult = await tx.execute<RoomRewardRow & Record<string, unknown>>(sqlOp`
      INSERT INTO content_treasuries
         (content_type, content_id, owner_id, funded_amount, remaining_amount, max_claimants, reward_action, custom_instructions, title, status)
       VALUES ('room', ${roomId}, ${ownerId}, ${amount}, ${amount}, ${maxClaimants}, ${rewardAction}, NULL, ${title.trim()}, 'active')
       ON CONFLICT (content_type, content_id) DO UPDATE SET
         funded_amount = ${amount}, remaining_amount = ${amount}, max_claimants = ${maxClaimants},
         reward_action = ${rewardAction}, custom_instructions = NULL, title = ${title.trim()},
         claimant_count = 0, status = 'active', updated_at = NOW()
       RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status, title, reward_action, custom_instructions
    `);
    return insertResult.rows[0];
  });

  return toRoomRewardState(result);
}

/** Deactivate a room's Custom Reward without deleting its claim history. */
export async function closeRoomReward(roomId: string): Promise<void> {
  const orm = await getDb();
  await orm
    .update(schema.contentTreasuries)
    .set({ status: "closed", updatedAt: sqlOp`NOW()` })
    .where(and(eq(schema.contentTreasuries.contentType, "room"), eq(schema.contentTreasuries.contentId, roomId)));
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
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const selectResult = await tx.execute<RoomRewardRow & Record<string, unknown>>(sqlOp`
      SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status, owner_id, title, reward_action, custom_instructions
       FROM content_treasuries WHERE content_type = 'room' AND content_id = ${roomId} FOR UPDATE
    `);
    const reward = selectResult.rows[0];
    if (!reward || reward.status !== "active") return null;
    if (reward.claimant_count >= reward.max_claimants) return null;
    if (reward.owner_id === userId) return null; // owner can't claim their own reward

    let payoutAmount = 0;
    if (reward.reward_action !== "custom_text") {
      payoutAmount = Math.floor(reward.funded_amount / reward.max_claimants);
      if (payoutAmount <= 0 || reward.remaining_amount < payoutAmount) return null;
    }

    const insertResult = await tx
      .insert(schema.contentTreasuryClaims)
      .values({ treasuryId: reward.id, userId, claimType: "gift", amount: payoutAmount })
      .onConflictDoNothing({ target: [schema.contentTreasuryClaims.treasuryId, schema.contentTreasuryClaims.userId] });
    if (!insertResult.rowCount || insertResult.rowCount === 0) return null; // already claimed this reward

    const newClaimantCount = reward.claimant_count + 1;
    const newRemaining = reward.remaining_amount - payoutAmount;
    const exhausted =
      newClaimantCount >= reward.max_claimants ||
      (reward.reward_action !== "custom_text" && newRemaining < payoutAmount);
    await tx.execute(sqlOp`
      UPDATE content_treasuries SET claimant_count = ${newClaimantCount}, remaining_amount = ${newRemaining}, status = ${exhausted ? "exhausted" : "active"}, updated_at = NOW() WHERE id = ${reward.id}
    `);

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
  onShareCounted: (tx: DbOrTx) => Promise<void>
): Promise<{ rewardClaimed: number | null }> {
  const orm = await getDb();
  const insertResult = await orm
    .insert(schema.contentShares)
    .values({ contentType, contentId, userId })
    .onConflictDoNothing();
  if (insertResult.rowCount && insertResult.rowCount > 0) {
    await orm.transaction(async (tx) => {
      await onShareCounted(tx);
    });
  }

  const claim = await claimContentTreasuryReward(contentType, contentId, userId, "share", claimRewardType, monetizationEnabled).catch((err) => {
    logger.error({ err, contentType, contentId, userId }, "[contentTreasury] failed to claim treasury reward for share");
    return null;
  });

  return { rewardClaimed: claim?.amount ?? null };
}
