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
import { db } from "@/lib/db";
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

interface ConversationRow {
  conversation_id: string | null;
  reply_count_from_recipient: number;
  message_count: number;
}

interface MessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  coin_cost: number;
  reply_count_from_recipient: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

interface ConversationListRow {
  conversation_id: string;
  other_user_id: string;
  other_username: string;
  other_display_name: string;
  other_avatar_emoji: string;
  last_message_content: string | null;
  last_message_at: string;
  unread_count: number;
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
  // Load gift item
  const { rows: giftRows } = await db.query<{
    id: string; name: string; emoji: string; coin_cost: number; tier: number;
  }>(
    `SELECT id, name, emoji, coin_cost, tier FROM gift_items WHERE id = $1 AND is_active = TRUE LIMIT 1`,
    [giftItemId]
  );
  if (!giftRows[0]) throw badRequest("Gift item not found or unavailable");
  const giftItem = giftRows[0];

  // Load recipient
  const { rows: recipientRows } = await db.query<{
    id: string; username: string; is_creator: boolean; creator_tier: string | null;
    is_suspended: boolean; dm_opt_out: boolean;
  }>(
    `SELECT id, username,
            COALESCE(is_creator, false) AS is_creator,
            creator_tier,
            COALESCE(is_suspended, false) AS is_suspended,
            COALESCE(dm_opt_out, false) AS dm_opt_out
     FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [recipientId]
  );
  if (!recipientRows[0]) throw badRequest("Recipient not found");
  const recipient = recipientRows[0];

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

  await db.transaction(async (tx) => {
    // Insert the gift record FIRST to obtain a deterministic reference_id that
    // makes the subsequent debit/credit calls idempotent on client retries.
    const { rows: giftInsert } = await tx.query<{ id: string }>(
      `INSERT INTO gifts (sender_id, recipient_id, gift_item_id, coin_value, coin_cost, room_id, status)
       VALUES ($1, $2, $3, $4, $4, NULL, 'delivered') RETURNING id`,
      [senderId, recipientId, giftItem.id, giftItem.coin_cost]
    );
    giftId = giftInsert[0].id;
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

    const { rows: convUpsert } = await tx.query<{ id: string }>(
      `INSERT INTO dm_conversations (user_id_1, user_id_2)
       VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
       ON CONFLICT (user_id_1, user_id_2) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [senderId, recipientId]
    );

    await tx.query(
      `INSERT INTO messages
         (sender_id, recipient_id, conversation_id, message_type, content, media_url, coin_cost, reply_count_from_recipient)
       VALUES ($1, $2, $3, 'gift', $4, NULL, 0, 0)`,
      [senderId, recipientId, convUpsert[0]?.id ?? null,
       `${giftItem.emoji} ${giftItem.name} (${giftItem.coin_cost} coins)`]
    );
  });

  // XP awards (fire-and-forget via safeAwardXP which includes DLQ fallback)
  {
    const { rows: senderPlanRows } = await db.query<{ plan: Plan }>(
      `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [senderId]
    ).catch(() => ({ rows: [] as Array<{ plan: Plan }> }));
    const senderPlan: Plan = senderPlanRows[0]?.plan ?? 'free';
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

  recordWarContribution(senderId, "send_gift", db).catch(() => {});

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

    // 1. Fetch sender plan and coin balance
    const { rows: senderRows } = await db.query<SenderRow>(
      `SELECT id, plan, coin_balance, is_admin
       FROM users
       WHERE id = $1 AND deleted_at IS NULL AND is_suspended = FALSE
       LIMIT 1`,
      [auth.user.sub]
    );
    const sender = senderRows[0];
    if (!sender) throw forbidden("Your account is not able to send messages");

    // 2. Verify recipient exists and is reachable
    const { rows: recipientRows } = await db.query<{
      id: string;
      is_suspended: boolean;
      dm_privacy: string;
      dm_opt_out: boolean;
    }>(
      `SELECT id, COALESCE(is_suspended, false) AS is_suspended,
              COALESCE(dm_privacy, 'everyone') AS dm_privacy,
              COALESCE(dm_opt_out, false) AS dm_opt_out
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [body.recipientId]
    );
    if (!recipientRows[0]) throw badRequest("Recipient not found");

    // Suspended recipients show a generic unavailable notice (no ban reason disclosed)
    if (recipientRows[0].is_suspended) {
      throw badRequest(
        "This account is temporarily unavailable.",
        "RECIPIENT_UNAVAILABLE"
      );
    }

    // dm_opt_out: user has globally opted out of receiving DMs
    if (recipientRows[0].dm_opt_out && !sender.is_admin) {
      throw badRequest(
        "This account is not accepting direct messages.",
        "RECIPIENT_UNAVAILABLE"
      );
    }

    // Block check: fail silently with generic error if recipient has blocked sender
    const { rows: blockRows } = await db.query<{ id: string }>(
      `SELECT id FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2 LIMIT 1`,
      [body.recipientId, auth.user.sub]
    );
    if (blockRows[0] && !sender.is_admin) {
      throw badRequest(
        "This account is temporarily unavailable.",
        "RECIPIENT_UNAVAILABLE"
      );
    }

    // dm_privacy: 'friends_only' — only friends can initiate
    if (recipientRows[0].dm_privacy === "friends_only" && !sender.is_admin) {
      const { rows: friendRows } = await db.query<{ id: string }>(
        `SELECT id FROM friendships
         WHERE ((requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1))
           AND status = 'accepted' LIMIT 1`,
        [auth.user.sub, body.recipientId]
      );
      if (!friendRows[0]) {
        throw forbidden("This user only accepts DMs from friends.");
      }
    }

    // 3. Check for an existing conversation between the two users
    const { rows: convRows } = await db.query<ConversationRow>(
      `SELECT
         c.id AS conversation_id,
         COALESCE(
           (SELECT COUNT(*) FROM messages m
            WHERE m.recipient_id = $1 AND m.sender_id = $2
              AND m.is_deleted = FALSE),
           0
         )::int AS reply_count_from_recipient,
         COALESCE(
           (SELECT COUNT(*) FROM messages m
            WHERE ((m.sender_id = $1 AND m.recipient_id = $2)
                OR (m.sender_id = $2 AND m.recipient_id = $1))
              AND m.is_deleted = FALSE),
           0
         )::int AS message_count
       FROM dm_conversations c
       WHERE c.user_id_1 = $1 AND c.user_id_2 = $2
       LIMIT 1`,
      // BUG-020 FIX: use canonicalDmPair to ensure the lookup hits the unique index
      // on (user_id_1, user_id_2). Previously the OR condition bypassed the index.
      canonicalDmPair(auth.user.sub, body.recipientId)
    );

    const existingConv = convRows[0] ?? null;
    const isInitiating = !existingConv || existingConv.message_count === 0;
    const replyCountFromRecipient = existingConv?.reply_count_from_recipient ?? 0;

    // 4. Enforce plan-based initiation rights
    if (isInitiating && !canInitiateDM(sender.plan) && !sender.is_admin) {
      throw forbidden(
        "Your current plan does not allow initiating new DM conversations. " +
          "Upgrade to Pro or Max to start conversations."
      );
    }

    // 4b. Idempotency check BEFORE incrementing the daily counter so that retried
    //     requests with the same idempotency key do not consume quota (BUG-MSG-01).
    if (body.idempotencyKey) {
      const { rows: dupRows } = await db.query<{ id: string }>(
        `SELECT id FROM messages
         WHERE sender_id = $1 AND idempotency_key = $2
         LIMIT 1`,
        [auth.user.sub, body.idempotencyKey]
      );
      if (dupRows[0]) {
        // Return the existing message — do not charge again
        const { rows: existingMsgRows } = await db.query<MessageRow>(
          `SELECT id, sender_id, recipient_id, message_type, content, media_url,
                  coin_cost, reply_count_from_recipient, is_deleted, created_at, updated_at
           FROM messages WHERE id = $1 LIMIT 1`,
          [dupRows[0].id]
        );
        return NextResponse.json({ message: existingMsgRows[0] }, { status: 200 });
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
    const message = await db.transaction(async (tx) => {
      // 9a. Upsert the dm_conversation record FIRST so its id can serve as the
      //     idempotency reference_id for the coin debit (TASK-03).
      const { rows: convUpsertRows } = await tx.query<{ id: string }>(
        `INSERT INTO dm_conversations (user_id_1, user_id_2)
         VALUES (
           LEAST($1::uuid, $2::uuid),
           GREATEST($1::uuid, $2::uuid)
         )
         ON CONFLICT (user_id_1, user_id_2) DO UPDATE
           SET updated_at = NOW()
         RETURNING id`,
        [auth.user.sub, body.recipientId]
      );
      const conversationId = convUpsertRows[0]?.id;

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
      const { rows: msgRows } = await tx.query<MessageRow>(
        `INSERT INTO messages
           (sender_id, recipient_id, conversation_id, message_type, content,
            media_url, coin_cost, reply_count_from_recipient, idempotency_key, sender_plan_at_creation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (sender_id, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING id, sender_id, recipient_id, message_type, content, media_url,
                   coin_cost, reply_count_from_recipient, is_deleted,
                   created_at, updated_at`,
        [
          auth.user.sub,
          body.recipientId,
          conversationId ?? null,
          body.messageType,
          filteredContent.trim() || "[Message removed by content filter]",
          body.mediaUrl ?? null,
          coinCost,
          replyCountFromRecipient,
          body.idempotencyKey ?? null,
          sender.plan,
        ]
      );

      // If the INSERT was a no-op (idempotency conflict), msgRows is empty.
      // Return null so the caller can fetch and return the existing message.
      return msgRows[0] ?? null;
    });

    if (!message) {
      // ON CONFLICT DO NOTHING returned zero rows — a concurrent request with the
      // same idempotency key already inserted this message. Fetch and return it.
      if (body.idempotencyKey) {
        const { rows: existingRows } = await db.query<MessageRow>(
          `SELECT id, sender_id, recipient_id, message_type, content, media_url,
                  coin_cost, reply_count_from_recipient, is_deleted, created_at, updated_at
           FROM messages WHERE sender_id = $1 AND idempotency_key = $2 LIMIT 1`,
          [auth.user.sub, body.idempotencyKey]
        );
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
    void triggerActivityQuestProgress(auth.user.sub, "send_text_message", db);

    // 12. Daily counter already incremented atomically in step 5 (BUG-10)

    // 13. Update conversation score — best-effort
    updateConversationScore(auth.user.sub, body.recipientId, "message_sent").catch(
      (err) => logger.error({ err }, "[dm:POST] Conversation score update failed")
    );

    // 14. Record guild war contribution — best-effort
    recordWarContribution(auth.user.sub, 'send_message', db).catch((err) => {
      logger.error({ err: err }, "[dm:POST] war contribution failed");
      });

    // 15. Realtime broadcast — push the new message to open clients
    if (message.id) {
      // Fetch the conversation id for the channel name (may be null for new convs)
      db.query<{ id: string }>(
        `SELECT id FROM dm_conversations
         WHERE (user_id_1 = LEAST($1::text, $2::text) AND user_id_2 = GREATEST($1::text, $2::text))
         LIMIT 1`,
        [auth.user.sub, body.recipientId]
      ).then(({ rows }) => {
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

    const cursorClause = cursor
      ? `AND c.last_message_at < $3`
      : "";

    const params: (string | number)[] = [auth.user.sub, limit];
    if (cursor) params.push(cursor);

    const { rows } = await db.query<ConversationListRow>(
      `SELECT
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
              AND unread.recipient_id = $1
              AND unread.is_read = FALSE
              AND unread.is_deleted = FALSE),
           0
         )::int AS unread_count
       FROM dm_conversations c
       JOIN users u ON u.id = CASE
         WHEN c.user_id_1 = $1 THEN c.user_id_2
         ELSE c.user_id_1
       END
       LEFT JOIN LATERAL (
         SELECT content FROM messages
         WHERE conversation_id = c.id AND is_deleted = FALSE
         ORDER BY created_at DESC LIMIT 1
       ) m ON TRUE
       WHERE (c.user_id_1 = $1 OR c.user_id_2 = $1)
         AND u.deleted_at IS NULL
         ${cursorClause}
       ORDER BY c.updated_at DESC
       LIMIT $2`,
      params
    );

    const nextCursor =
      rows.length === limit
        ? rows[rows.length - 1]?.last_message_at ?? null
        : null;

    return NextResponse.json(
      {
        items: rows,
        nextCursor,
        hasMore: nextCursor !== null,
        total: rows.length,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
