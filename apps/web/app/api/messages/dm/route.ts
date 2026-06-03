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
  checkDailyLimitReached,
  incrementDailyCount,
} from "@/lib/messaging/coinCost";
import { filterDMContent } from "@/lib/messaging/antispam";
import { updateConversationScore } from "@/lib/messaging/conversationScore";
import type { Plan } from "@zobia/types";

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
    .max(2000, "Message content cannot exceed 2000 characters"),
  messageType: z.enum(["text", "gif", "moment"]).default("text"),
  mediaUrl: z.string().url("mediaUrl must be a valid URL").optional(),
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

/**
 * Send a direct message to another user.
 *
 * Coin deduction and message creation are wrapped in a single database
 * transaction to guarantee atomicity — coins are never deducted without
 * a corresponding message record being created.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", DM_SEND_RATE_LIMIT);

    const body = await validateBody(req, sendDMSchema);

    // Prevent messaging yourself
    if (body.recipientId === auth.user.sub) {
      throw badRequest("You cannot send a DM to yourself");
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
       WHERE (c.user_id_1 = $1 AND c.user_id_2 = $2)
          OR (c.user_id_1 = $2 AND c.user_id_2 = $1)
       LIMIT 1`,
      [auth.user.sub, body.recipientId]
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

    // 5. Check daily limits
    const dailyCheck = await checkDailyLimitReached(
      auth.user.sub,
      sender.plan
    );
    if (isInitiating && dailyCheck.sentLimitReached) {
      throw conflict(
        "You have reached your daily DM limit. Try again tomorrow.",
        "DAILY_LIMIT_REACHED"
      );
    }
    if (!isInitiating && dailyCheck.replyLimitReached) {
      throw conflict(
        "You have reached your daily reply limit. Try again tomorrow.",
        "DAILY_LIMIT_REACHED"
      );
    }

    // 6. Compute coin cost
    const coinCost = getDMCost(sender.plan, isInitiating);

    if (coinCost > 0 && sender.coin_balance < coinCost && !sender.is_admin) {
      throw conflict(
        `Insufficient coins. This action costs ${coinCost} coin(s).`,
        "INSUFFICIENT_COINS"
      );
    }

    // 7. Apply anti-spam filter silently
    const filteredContent = filterDMContent(
      body.content,
      replyCountFromRecipient,
      sender.is_admin
    );

    // 8. Idempotency check
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

    // 9. Atomic transaction: deduct coins + create message + upsert conversation
    const message = await db.transaction(async (tx) => {
      // 9a. Deduct coins (if cost > 0)
      if (coinCost > 0 && !sender.is_admin) {
        const { rows: deductRows } = await tx.query<{ coin_balance: number }>(
          `UPDATE users
           SET coin_balance = coin_balance - $1, updated_at = NOW()
           WHERE id = $2 AND coin_balance >= $1 AND deleted_at IS NULL
           RETURNING coin_balance`,
          [coinCost, auth.user.sub]
        );
        if (!deductRows[0]) {
          throw conflict("Insufficient coins", "INSUFFICIENT_COINS");
        }

        // Write coin ledger entry
        await tx.query(
          `INSERT INTO coin_ledger
             (user_id, amount, balance_before, balance_after, transaction_type,
              reference_id, description)
           VALUES ($1, $2, $3, $4, 'dm_cost', NULL, 'DM coin cost')`,
          [
            auth.user.sub,
            -coinCost,
            sender.coin_balance,
            deductRows[0].coin_balance,
          ]
        );
      }

      // 9b. Upsert the dm_conversation record
      const { rows: convUpsertRows } = await tx.query<{ id: string }>(
        `INSERT INTO dm_conversations (user_id_1, user_id_2)
         VALUES (
           LEAST($1::text, $2::text),
           GREATEST($1::text, $2::text)
         )
         ON CONFLICT (user_id_1, user_id_2) DO UPDATE
           SET updated_at = NOW()
         RETURNING id`,
        [auth.user.sub, body.recipientId]
      );
      const conversationId = convUpsertRows[0]?.id;

      // 9c. Create message record
      const { rows: msgRows } = await tx.query<MessageRow>(
        `INSERT INTO messages
           (sender_id, recipient_id, conversation_id, message_type, content,
            media_url, coin_cost, reply_count_from_recipient, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, sender_id, recipient_id, message_type, content, media_url,
                   coin_cost, reply_count_from_recipient, is_deleted,
                   created_at, updated_at`,
        [
          auth.user.sub,
          body.recipientId,
          conversationId ?? null,
          body.messageType,
          filteredContent || null,
          body.mediaUrl ?? null,
          coinCost,
          replyCountFromRecipient,
          body.idempotencyKey ?? null,
        ]
      );

      return msgRows[0];
    });

    if (!message) {
      throw new Error("Message creation failed");
    }

    // 10. Award XP (1 XP, Social track) — best-effort, outside transaction
    db.query(
      `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, multiplier, base_amount)
       VALUES ($1, 1, 'social', 'message', $2, 1, 1)`,
      [auth.user.sub, message.id]
    ).catch((err) =>
      console.error("[dm:POST] XP award failed", err)
    );

    // 11. Update user total XP — best-effort
    db.query(
      `UPDATE users SET xp_total = xp_total + 1, xp_social = xp_social + 1, updated_at = NOW()
       WHERE id = $1`,
      [auth.user.sub]
    ).catch((err) =>
      console.error("[dm:POST] XP user update failed", err)
    );

    // 12. Increment daily counter
    incrementDailyCount(auth.user.sub, isInitiating ? "sent" : "reply").catch(
      (err) => console.error("[dm:POST] Daily count increment failed", err)
    );

    // 13. Update conversation score — best-effort
    updateConversationScore(auth.user.sub, body.recipientId, "message_sent").catch(
      (err) => console.error("[dm:POST] Conversation score update failed", err)
    );

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
export const GET = withAuth(async (req: NextRequest, { auth }) => {
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
