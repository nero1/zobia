export const dynamic = 'force-dynamic';

/**
 * app/api/messages/dm/route.ts
 *
 * Direct message endpoints.
 *
 * POST /api/messages/dm — Send a DM
 *   - Validates auth
 *   - Enforces plan-based initiation rights (Pro+ only)
 *   - Deducts coin cost atomically before creating the message
 *   - Silently applies anti-spam filter (no notification to sender)
 *   - Awards 1 XP to sender on the Social track
 *   - Updates the conversation score
 *   - Rate limited
 *
 * GET /api/messages/dm — List conversations for the current user
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import {
  getDMCost,
  canInitiateDM,
  checkAndIncrementDailyCount,
} from "@/lib/messaging/coinCost";
import { filterDMContent } from "@/lib/messaging/antispam";
import { canonicalDmPair } from "@/lib/messaging/canonicalDmPair";
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";
import { updateConversationScore } from "@/lib/messaging/conversationScore";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";
import { advanceNewMemberQuestStep } from "@/lib/quests/newMemberQuestEngine";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { publishRealtimeEvent } from "@/lib/realtime";
import { calculateFinalXP } from "@/lib/xp/engine";
import type { Plan } from "@zobia/types";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Rate limit preset for DM sends (tighter than generic write)
// ---------------------------------------------------------------------------

const DM_SEND_RATE_LIMIT = {
  limit: 30,
  windowMs: 60 * 1000,
  name: "dm:send",
} as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const sendDMSchema = z.object({
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  content: z
    .string()
    .min(1, "Message content cannot be empty")
    .max(2000, "Message content cannot exceed 2000 characters")
    .optional(),
  messageType: z.enum(["text", "gif", "moment", "sticker", "gift"]).default("text"),
  mediaUrl: z.string().url("mediaUrl must be a valid URL").optional(),
  /** UUID of the gift item (required when messageType is "gift"). */
  giftItemId: z.string().uuid("giftItemId must be a valid UUID").optional(),
  /** Client-generated idempotency key to prevent duplicate sends. */
  idempotencyKey: z.string().max(128).optional(),
});

const listDMsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface SenderRow {
  id: string;
  plan: Plan;
  coin_balance: number;
  is_admin: boolean;
}

interface ConversationRow extends Record<string, unknown> {
  conversation_id: string | null;
  reply_count_from_recipient: number;
  message_count: number;
}

interface MessageRow extends Record<string, unknown> {
  id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string | null;
  message_type: string;
  content: string | null;
  media_url: string | null;
  coin_cost: number;
  reply_count_from_recipient: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

interface ConversationListRow extends Record<string, unknown> {
  conversation_id: string;
  other_user_id: string;
  other_username: string;
  other_display_name: string;
  other_avatar_emoji: string;
  last_message_content: string | null;
  last_message_at: string;
  unread_count: number;
}

/** Selects a single `messages` row shaped like the legacy `MessageRow`. */
async function selectMessageRow(
  orm: Awaited<ReturnType<typeof getDb>>,
  where: ReturnType<typeof eq>
): Promise<MessageRow | undefined> {
  const [row] = await orm
    .select({
      id: schema.messages.id,
      sender_id: schema.messages.senderId,
      recipient_id: schema.messages.recipientId,
      conversation_id: schema.messages.conversationId,
      message_type: schema.messages.messageType,
      content: schema.messages.content,
      media_url: schema.messages.mediaUrl,
      coin_cost: schema.messages.coinCost,
      reply_count_from_recipient: schema.messages.replyCountFromRecipient,
      is_deleted: schema.messages.isDeleted,
      created_at: schema.messages.createdAt,
      updated_at: schema.messages.updatedAt,
    })
    .from(schema.messages)
    .where(where)
    .limit(1);
  if (!row) return undefined;
  return {
    ...row,
    recipient_id: row.recipient_id ?? "",
    conversation_id: row.conversation_id,
    coin_cost: Number(row.coin_cost ?? 0),
    reply_count_from_recipient: row.reply_count_from_recipient ?? 0,
    is_deleted: row.is_deleted ?? false,
    created_at: (row.created_at as unknown as Date)?.toISOString?.() ?? String(row.created_at),
    updated_at: (row.updated_at as unknown as Date)?.toISOString?.() ?? String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// POST /api/messages/dm
// ---------------------------------------------------------------------------

// Gift fee constants (mirrors apps/web/app/api/economy/gifts/send/route.ts)
const CREATOR_GIFT_FEE_PERCENT = 20;
const USER_GIFT_FEE_PERCENT = 5;

/**
 * Handle a gift message sent via the DM endpoint.
 * Deducts coins, applies fee split, creates the gift record and DM message.
 */
async function handleDMGift(
  senderId: string,
  recipientId: string,
  giftItemId: string
): Promise<NextResponse> {
  const orm = await getDb();

  // Load gift item, resolving a matching gift_type by name (see NOTE below).
  const giftRows = await orm
    .select({
      id: schema.giftItems.id,
      name: schema.giftItems.name,
      emoji: schema.giftItems.emoji,
      coin_cost: schema.giftItems.coinCost,
      tier: schema.giftItems.tier,
      giftTypeId: schema.giftTypes.id,
    })
    .from(schema.giftItems)
    .leftJoin(
      schema.giftTypes,
      and(eq(schema.giftTypes.name, schema.giftItems.name), eq(schema.giftTypes.isActive, true))
    )
    .where(
      and(eq(schema.giftItems.id, giftItemId), eq(schema.giftItems.isActive, true), eq(schema.giftItems.isRetired, false))
    )
    .limit(1);
  if (!giftRows[0]) throw badRequest("Gift item not found or unavailable");
  const giftItemRow = giftRows[0];
  const giftItem = { ...giftItemRow, coin_cost: Number(giftItemRow.coin_cost) };

  // Load recipient
  const [recipientRow] = await orm
    .select({
      id: schema.users.id,
      username: schema.users.username,
      is_creator: schema.users.isCreator,
      creator_tier: schema.users.creatorTier,
      is_suspended: schema.users.isSuspended,
      dm_opt_out: schema.users.dmOptOut,
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, recipientId), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!recipientRow) throw badRequest("Recipient not found");
  const recipient = {
    ...recipientRow,
    is_creator: recipientRow.is_creator ?? false,
    is_suspended: recipientRow.is_suspended ?? false,
    dm_opt_out: recipientRow.dm_opt_out ?? false,
  };

  if (recipient.is_suspended || recipient.dm_opt_out) {
    throw badRequest("This account is not accepting messages.", "RECIPIENT_UNAVAILABLE");
  }

  // Fee split
  const feePercent = recipient.is_creator
    ? (recipient.creator_tier === "icon" ? 15 : CREATOR_GIFT_FEE_PERCENT)
    : USER_GIFT_FEE_PERCENT;
  const platformFee = Math.floor((giftItem.coin_cost * feePercent) / 100);
  const recipientCoins = giftItem.coin_cost - platformFee;

  let giftId!: string;

  await orm.transaction(async (tx) => {
    // Insert the gift record FIRST to obtain a deterministic reference_id that
    // makes the subsequent debit/credit calls idempotent on client retries.
    // NOTE: schema.gifts.giftTypeId is declared NOT NULL, but the LEFT JOIN
    // above can legitimately produce no match for a legacy gift_items row
    // with no matching gift_types row by name. Preserving the original
    // raw-SQL behavior (attempt NULL, let the DB constraint decide) rather
    // than silently changing it — flagged as a pre-existing schema/behavior
    // mismatch, not introduced here. See app/api/economy/gifts/send/route.ts
    // for the same pattern.
    const [giftInsert] = await tx
      .insert(schema.gifts)
      .values({
        senderId,
        recipientId,
        giftItemId: giftItem.id,
        giftTypeId: giftItem.giftTypeId ?? (null as unknown as string),
        coinValue: BigInt(giftItem.coin_cost),
        coinCost: BigInt(giftItem.coin_cost),
        roomId: null,
        status: "delivered",
      })
      .returning({ id: schema.gifts.id });
    giftId = giftInsert.id;
    const giftRef = `dm_gift:${giftId}`;

    await debitCoins(
      senderId,
      giftItem.coin_cost,
      "gift_sent",
      giftRef,
      `Sent ${giftItem.emoji} ${giftItem.name} to @${recipient.username}`,
      { recipientId, giftItemId: giftItem.id },
      tx
    );

    await creditCoins(
      recipientId,
      recipientCoins,
      "gift_received",
      giftRef,
      `Received ${giftItem.emoji} ${giftItem.name} via DM`,
      { senderId, giftItemId: giftItem.id },
      tx
    );

    // BUG-DM-01 FIX: DM gifts are virtual-coin denominated, NOT fiat (kobo).
    // Inserting coin values into creator_earnings kobo columns corrupts payout
    // accounting. The coin_ledger entries from creditCoins above are the
    // canonical record. Fiat conversion happens at withdrawal time only.

    const [uid1, uid2] = canonicalDmPair(senderId, recipientId);
    const [convUpsert] = await tx
      .insert(schema.dmConversations)
      .values({ userId1: uid1, userId2: uid2 })
      .onConflictDoUpdate({
        target: [schema.dmConversations.userId1, schema.dmConversations.userId2],
        set: { updatedAt: sql`NOW()` },
      })
      .returning({ id: schema.dmConversations.id });

    await tx.insert(schema.messages).values({
      senderId,
      recipientId,
      conversationId: convUpsert?.id ?? null,
      messageType: "gift",
      content: `${giftItem.emoji} ${giftItem.name} (${giftItem.coin_cost} coins)`,
      mediaUrl: null,
      coinCost: BigInt(0),
      replyCountFromRecipient: 0,
    });
  });

  // XP awards (fire-and-forget via safeAwardXP which includes DLQ fallback)
  {
    const senderPlanRows = await orm
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(and(eq(schema.users.id, senderId), isNull(schema.users.deletedAt)))
      .limit(1)
      .catch(() => [] as Array<{ plan: Plan }>);
    const senderPlan: Plan = (senderPlanRows[0]?.plan as Plan | undefined) ?? 'free';
    const { finalXp: giftSenderFinalXp } = calculateFinalXP(
      'send_gift_message',
      { plan: senderPlan, isMessagingAction: true }
    );
    const { finalXp: giftRecipFinalXp } = calculateFinalXP(
      'receive_gift_and_react',
      { plan: 'free', isMessagingAction: false }
    );
    safeAwardXP(senderId, giftSenderFinalXp, 'generosity', 'gift_sent', `dm_gift_sent:${giftId}`).catch(() => {});
    safeAwardXP(recipientId, giftRecipFinalXp, 'social', 'gift_received', `dm_gift_received:${giftId}`).catch(() => {});
  }

  void triggerActivityQuestProgress(senderId, "gift", orm);
  void advanceNewMemberQuestStep(orm, senderId, "gift_someone");

  recordWarContribution(senderId, "send_gift", orm).catch(() => {});

  return NextResponse.json({
    success: true,
    giftId: giftId!,
    gift: { id: giftItem.id, name: giftItem.name, emoji: giftItem.emoji, tier: giftItem.tier, coinCost: giftItem.coin_cost },
    recipient: { id: recipient.id, username: recipient.username },
  }, { status: 201 });
}

/**
 * Send a direct message to another user.
 *
 * Coin deduction and message creation are wrapped in a single database
 * transaction to guarantee atomicity — coins are never deducted without
 * a corresponding message record being created.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", DM_SEND_RATE_LIMIT);

    const body = await validateBody(req, sendDMSchema);

    // Prevent messaging yourself
    if (body.recipientId === auth.user.sub) {
      throw badRequest("You cannot send a DM to yourself");
    }

    // Gift messages require giftItemId and bypass the normal DM coin cost flow
    if (body.messageType === "gift") {
      if (!body.giftItemId) {
        throw badRequest("giftItemId is required when messageType is 'gift'");
      }
      return handleDMGift(auth.user.sub, body.recipientId, body.giftItemId);
    }

    if (!body.content) {
      throw badRequest("content is required for non-gift messages");
    }

    const orm = await getDb();

    // 1. Fetch sender plan and coin balance
    const [senderRow] = await orm
      .select({
        id: schema.users.id,
        plan: schema.users.plan,
        coin_balance: schema.users.coinBalance,
        is_admin: schema.users.isAdmin,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt), eq(schema.users.isSuspended, false)))
      .limit(1);
    if (!senderRow) throw forbidden("Your account is not able to send messages");
    const sender = { ...senderRow, plan: senderRow.plan as Plan, coin_balance: Number(senderRow.coin_balance) };

    // 2. Verify recipient exists and is reachable
    const [recipientRow] = await orm
      .select({
        id: schema.users.id,
        is_suspended: schema.users.isSuspended,
        dm_privacy: schema.users.dmPrivacy,
        dm_opt_out: schema.users.dmOptOut,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, body.recipientId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!recipientRow) throw badRequest("Recipient not found");

    // Suspended recipients show a generic unavailable notice (no ban reason disclosed)
    if (recipientRow.is_suspended) {
      throw badRequest(
        "This account is temporarily unavailable.",
        "RECIPIENT_UNAVAILABLE"
      );
    }

    // dm_opt_out: user has globally opted out of receiving DMs
    if (recipientRow.dm_opt_out && !sender.is_admin) {
      throw badRequest(
        "This account is not accepting direct messages.",
        "RECIPIENT_UNAVAILABLE"
      );
    }

    // Block check: fail silently with generic error if recipient has blocked sender
    const [blockRow] = await orm
      .select({ id: schema.userBlocks.id })
      .from(schema.userBlocks)
      .where(and(eq(schema.userBlocks.blockerId, body.recipientId), eq(schema.userBlocks.blockedId, auth.user.sub)))
      .limit(1);
    if (blockRow && !sender.is_admin) {
      throw badRequest(
        "This account is temporarily unavailable.",
        "RECIPIENT_UNAVAILABLE"
      );
    }

    // dm_privacy: 'friends_only' — only friends can initiate
    if (recipientRow.dm_privacy === "friends_only" && !sender.is_admin) {
      const [friendRow] = await orm
        .select({ id: schema.friendships.id })
        .from(schema.friendships)
        .where(
          and(
            or(
              and(eq(schema.friendships.requesterId, auth.user.sub), eq(schema.friendships.addresseeId, body.recipientId)),
              and(eq(schema.friendships.requesterId, body.recipientId), eq(schema.friendships.addresseeId, auth.user.sub))
            ),
            eq(schema.friendships.status, "accepted")
          )
        )
        .limit(1);
      if (!friendRow) {
        throw forbidden("This user only accepts DMs from friends.");
      }
    }

    // 3. Check for an existing conversation between the two users
    // BUG-020 FIX: use canonicalDmPair to ensure the lookup hits the unique index
    // on (user_id_1, user_id_2). Previously the OR condition bypassed the index.
    const [uid1, uid2] = canonicalDmPair(auth.user.sub, body.recipientId);
    const convResult = await orm.execute<ConversationRow>(sql`
      SELECT
        c.id AS conversation_id,
        COALESCE(
          (SELECT COUNT(*) FROM messages m
           WHERE m.recipient_id = ${uid1} AND m.sender_id = ${uid2}
             AND m.is_deleted = FALSE),
          0
        )::int AS reply_count_from_recipient,
        COALESCE(
          (SELECT COUNT(*) FROM messages m
           WHERE ((m.sender_id = ${uid1} AND m.recipient_id = ${uid2})
               OR (m.sender_id = ${uid2} AND m.recipient_id = ${uid1}))
             AND m.is_deleted = FALSE),
          0
        )::int AS message_count
      FROM dm_conversations c
      WHERE c.user_id_1 = ${uid1} AND c.user_id_2 = ${uid2}
      LIMIT 1
    `);

    const existingConv = convResult.rows[0] ?? null;
    const isInitiating = !existingConv || existingConv.message_count === 0;
    const replyCountFromRecipient = existingConv?.reply_count_from_recipient ?? 0;

    // 4. Enforce plan-based initiation rights
    if (isInitiating && !canInitiateDM(sender.plan) && !sender.is_admin) {
      throw forbidden(
        "Your current plan does not allow initiating new DM conversations. " +
          "Upgrade to Pro or Max to start conversations.",
        "PLAN_RESTRICTION"
      );
    }

    // 4b. Idempotency check BEFORE incrementing the daily counter so that retried
    //     requests with the same idempotency key do not consume quota (BUG-MSG-01).
    if (body.idempotencyKey) {
      const [dupRow] = await orm
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(and(eq(schema.messages.senderId, auth.user.sub), eq(schema.messages.idempotencyKey, body.idempotencyKey)))
        .limit(1);
      if (dupRow) {
        // Return the existing message — do not charge again
        const existingMsg = await selectMessageRow(orm, eq(schema.messages.id, dupRow.id));
        return NextResponse.json({ message: existingMsg }, { status: 200 });
      }
    }

    // 5. Atomically check daily limits and increment counter (BUG-10: eliminates
    //    the TOCTOU race between separate checkDailyLimitReached + incrementDailyCount calls)
    const dmType = isInitiating ? "sent" : "reply";
    const { allowed: dailyAllowed } = await checkAndIncrementDailyCount(
      auth.user.sub,
      dmType,
      sender.plan
    );
    if (!dailyAllowed) {
      throw conflict(
        isInitiating
          ? "You have reached your daily DM limit. Try again tomorrow."
          : "You have reached your daily reply limit. Try again tomorrow.",
        "DAILY_LIMIT_REACHED"
      );
    }

    // 6. Compute coin cost
    const coinCost = getDMCost(sender.plan, isInitiating);

    if (coinCost !== null && coinCost > 0 && sender.coin_balance < coinCost && !sender.is_admin) {
      return NextResponse.json(
        {
          error: {
            code: "INSUFFICIENT_COINS",
            message: `Insufficient coins. This action costs ${coinCost} coin(s).`,
            coinCost,
            coinBalance: sender.coin_balance,
          },
        },
        { status: 409 }
      );
    }

    // 7. Apply anti-spam filter silently
    const messageContent = body.content as string; // non-gift path guarantees content
    const filteredContent = filterDMContent(
      messageContent,
      replyCountFromRecipient,
      sender.is_admin
    );

    // PRD §8: If the anti-spam filter stripped all content, silently return 201
    // without persisting anything — the sender must not know the message was blocked.
    if (!sender.is_admin && messageContent.trim().length > 0 && filteredContent.trim().length === 0) {
      return NextResponse.json(
        {
          message: {
            id: `blocked-${Date.now()}`,
            sender_id: auth.user.sub,
            recipient_id: body.recipientId,
            conversation_id: null,
            message_type: body.messageType,
            content: messageContent,
            media_url: body.mediaUrl ?? null,
            coin_cost: 0,
            reply_count_from_recipient: replyCountFromRecipient,
            is_deleted: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
        { status: 201 }
      );
    }

    // 9. Atomic transaction: deduct coins + create message + upsert conversation
    const message = await orm.transaction(async (tx) => {
      // 9a. Upsert the dm_conversation record FIRST so its id can serve as the
      //     idempotency reference_id for the coin debit (TASK-03).
      const [txUid1, txUid2] = canonicalDmPair(auth.user.sub, body.recipientId);
      const [convUpsert] = await tx
        .insert(schema.dmConversations)
        .values({ userId1: txUid1, userId2: txUid2 })
        .onConflictDoUpdate({
          target: [schema.dmConversations.userId1, schema.dmConversations.userId2],
          set: { updatedAt: sql`NOW()` },
        })
        .returning({ id: schema.dmConversations.id });
      const conversationId = convUpsert?.id;

      // 9b. Deduct coins via debitCoins() — writes a ledger row and is idempotent
      //     on conversationId, preventing double-charges on client retries.
      if (coinCost !== null && coinCost > 0 && !sender.is_admin) {
        try {
          await debitCoins(
            auth.user.sub,
            coinCost,
            "dm_cost",
            conversationId ?? null,
            "DM coin cost",
            null,
            tx
          );
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "INSUFFICIENT_BALANCE") {
            throw conflict("Insufficient coins", "INSUFFICIENT_COINS");
          }
          throw err;
        }
      }

      // 9c. Create message record.
      // BUG-IDEM-01 FIX: use ON CONFLICT on the unique partial index
      // (messages_sender_idempotency_key_uq) to enforce idempotency atomically at
      // the DB level. The pre-check SELECT (step 8) remains as a fast-path but is
      // no longer the correctness guard — only the DB constraint is.
      const [msgRow] = await tx
        .insert(schema.messages)
        .values({
          senderId: auth.user.sub,
          recipientId: body.recipientId,
          conversationId: conversationId ?? null,
          messageType: body.messageType,
          content: filteredContent.trim() || "[Message removed by content filter]",
          mediaUrl: body.mediaUrl ?? null,
          coinCost: BigInt(coinCost ?? 0),
          replyCountFromRecipient,
          idempotencyKey: body.idempotencyKey ?? null,
          senderPlanAtCreation: sender.plan,
        })
        .onConflictDoNothing({
          target: [schema.messages.senderId, schema.messages.idempotencyKey],
        })
        .returning({
          id: schema.messages.id,
          sender_id: schema.messages.senderId,
          recipient_id: schema.messages.recipientId,
          conversation_id: schema.messages.conversationId,
          message_type: schema.messages.messageType,
          content: schema.messages.content,
          media_url: schema.messages.mediaUrl,
          coin_cost: schema.messages.coinCost,
          reply_count_from_recipient: schema.messages.replyCountFromRecipient,
          is_deleted: schema.messages.isDeleted,
          created_at: schema.messages.createdAt,
          updated_at: schema.messages.updatedAt,
        });

      // If the INSERT was a no-op (idempotency conflict), msgRow is undefined.
      // Return null so the caller can fetch and return the existing message.
      if (!msgRow) return null;
      return {
        ...msgRow,
        recipient_id: msgRow.recipient_id ?? "",
        coin_cost: Number(msgRow.coin_cost ?? 0),
        reply_count_from_recipient: msgRow.reply_count_from_recipient ?? 0,
        is_deleted: msgRow.is_deleted ?? false,
        created_at: (msgRow.created_at as unknown as Date)?.toISOString?.() ?? String(msgRow.created_at),
        updated_at: (msgRow.updated_at as unknown as Date)?.toISOString?.() ?? String(msgRow.updated_at),
      } as MessageRow;
    });

    if (!message) {
      // ON CONFLICT DO NOTHING returned zero rows — a concurrent request with the
      // same idempotency key already inserted this message. Fetch and return it.
      if (body.idempotencyKey) {
        const { rows: existingRows } = await orm.execute<MessageRow>(sql`
          SELECT id, sender_id, recipient_id, conversation_id, message_type, content, media_url,
                 coin_cost, reply_count_from_recipient, is_deleted, created_at, updated_at
          FROM messages WHERE sender_id = ${auth.user.sub} AND idempotency_key = ${body.idempotencyKey} LIMIT 1
        `);
        if (existingRows[0]) {
          return NextResponse.json({ message: existingRows[0] }, { status: 200 });
        }
      }
      throw new Error("Message creation failed");
    }

    // 10. Award XP (Social track, plan multiplier applied) — best-effort, outside transaction.
    //     safeAwardXP uses message.id as reference_id for idempotency and writes to the
    //     failed_xp_awards DLQ on failure instead of silently dropping the XP.
    {
      const { finalXp: dmFinalXp } = calculateFinalXP(
        'send_text_message',
        { plan: sender.plan, isMessagingAction: true }
      );
      safeAwardXP(auth.user.sub, dmFinalXp, "social", "dm_initiation", `msg_${message.id}`)
        .then(() => {
          if (dmFinalXp > 0) {
            return publishRealtimeEvent(`user:${auth.user.sub}`, "reward_earned", {
              type: "xp",
              amount: dmFinalXp,
            });
          }
        })
        .catch((err) => logger.error({ err }, "[dm:POST] XP award failed"));
    }

    // Trigger matching daily quest progress for sending a DM
    void triggerActivityQuestProgress(auth.user.sub, "messages", orm);
    void advanceNewMemberQuestStep(orm, auth.user.sub, "send_message");

    // 12. Daily counter already incremented atomically in step 5 (BUG-10)

    // 13. Update conversation score — best-effort
    updateConversationScore(auth.user.sub, body.recipientId, "message_sent").catch(
      (err) => logger.error({ err }, "[dm:POST] Conversation score update failed")
    );

    // 14. Record guild war contribution — best-effort
    recordWarContribution(auth.user.sub, 'send_message', orm).catch((err) => {
      logger.error({ err: err }, "[dm:POST] war contribution failed");
      });

    // 15. Realtime broadcast — push the new message to open clients
    if (message.id) {
      // Fetch the conversation id for the channel name (may be null for new convs)
      orm.execute<{ id: string } & Record<string, unknown>>(sql`
        SELECT id FROM dm_conversations
        WHERE (user_id_1 = LEAST(${auth.user.sub}::text, ${body.recipientId}::text) AND user_id_2 = GREATEST(${auth.user.sub}::text, ${body.recipientId}::text))
        LIMIT 1
      `).then(({ rows }) => {
        if (rows[0]?.id) {
          return publishRealtimeEvent(
            `dm:conversation:${rows[0].id}`,
            "new_message",
            { message }
          );
        }
      }).catch(() => {});
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/messages/dm
// ---------------------------------------------------------------------------

/**
 * Return the paginated list of DM conversations for the authenticated user.
 * Sorted by most recent message descending.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { limit, cursor } = validateSearchParams(
      req.nextUrl.searchParams,
      listDMsQuerySchema
    );

    const orm = await getDb();
    const cursorClause = cursor
      ? sql`AND c.last_message_at < ${cursor}`
      : sql``;

    const { rows } = await orm.execute<ConversationListRow>(sql`
      SELECT
         c.id AS conversation_id,
         u.id AS other_user_id,
         u.username AS other_username,
         u.display_name AS other_display_name,
         u.avatar_emoji AS other_avatar_emoji,
         m.content AS last_message_content,
         c.updated_at AS last_message_at,
         COALESCE(
           (SELECT COUNT(*) FROM messages unread
            WHERE unread.conversation_id = c.id
              AND unread.recipient_id = ${auth.user.sub}
              AND unread.is_read = FALSE
              AND unread.is_deleted = FALSE),
           0
         )::int AS unread_count
       FROM dm_conversations c
       JOIN users u ON u.id = CASE
         WHEN c.user_id_1 = ${auth.user.sub} THEN c.user_id_2
         ELSE c.user_id_1
       END
       LEFT JOIN LATERAL (
         SELECT content FROM messages
         WHERE conversation_id = c.id AND is_deleted = FALSE
         ORDER BY created_at DESC LIMIT 1
       ) m ON TRUE
       WHERE (c.user_id_1 = ${auth.user.sub} OR c.user_id_2 = ${auth.user.sub})
         AND u.deleted_at IS NULL
         ${cursorClause}
       ORDER BY c.updated_at DESC
       LIMIT ${limit}
    `);

    const nextCursor =
      rows.length === limit
        ? rows[rows.length - 1]?.last_message_at ?? null
        : null;

    const conversations = rows.map((row) => ({
      conversationId: row.conversation_id,
      participantUserId: row.other_user_id,
      participantUsername: row.other_username,
      participantDisplayName: row.other_display_name,
      participantAvatarEmoji: row.other_avatar_emoji,
      lastMessage: row.last_message_content ?? "",
      lastMessageAt: row.last_message_at,
      unreadCount: row.unread_count,
    }));

    return NextResponse.json(
      {
        conversations,
        nextCursor,
        hasMore: nextCursor !== null,
        total: conversations.length,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
