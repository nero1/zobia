export const dynamic = 'force-dynamic';

/**
 * app/api/messages/dm/[conversationId]/route.ts
 *
 * GET /api/messages/dm/[conversationId]
 *   Returns messages in a specific DM conversation (cursor-based pagination).
 *   Only participants may access it.
 *
 * POST /api/messages/dm/[conversationId]
 *   Send a message in an existing DM conversation.
 *   Coin deduction, anti-spam, and realtime broadcast are all applied.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateSearchParams, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDMCost, checkDailyLimitReached, incrementDailyCount } from "@/lib/messaging/coinCost";
import { filterDMContent } from "@/lib/messaging/antispam";
import { applyAutoModeration } from "@/lib/moderation/contentFilter";
import { updateConversationScore } from "@/lib/messaging/conversationScore";
import { debitCoins } from "@/lib/economy/coins";
import { publishRealtimeEvent } from "@/lib/realtime";
import { calculateFinalXP, PLAN_XP_MULTIPLIERS_BP } from "@/lib/xp/engine";
import type { Plan } from "@zobia/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 30)),
  /** Cursor: ISO-8601 timestamp of the oldest message from the previous page. */
  before: z.string().optional(),
  /** Cursor: ID of the oldest message from the previous page (used with `before` for tie-breaking). */
  beforeId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ConversationParticipantRow {
  user_id_1: string;
  user_id_2: string;
}

interface RecipientInfoRow {
  id: string;
  coin_balance: number;
  plan: Plan;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
}

interface MessageRow {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_display_name: string;
  sender_avatar_emoji: string;
  recipient_id: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  coin_cost: number;
  is_deleted: boolean;
  reactions: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * Fetch messages in a DM conversation (newest-first, cursor-based).
 *
 * Results are returned in descending order so FlatList (inverted) renders
 * the most recent message at the bottom without reversing the array.
 *
 * @param req  - Incoming Next.js request
 * @param ctx  - Route context with conversationId param and auth
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { conversationId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

      const { conversationId } = params;

      // 1. Verify the conversation exists and the user is a participant
      const { rows: convRows } = await db.query<ConversationParticipantRow>(
        `SELECT user_id_1, user_id_2
         FROM dm_conversations
         WHERE id = $1
         LIMIT 1`,
        [conversationId]
      );

      const conv = convRows[0];
      if (!conv) throw notFound("Conversation not found");

      const isParticipant =
        conv.user_id_1 === auth.user.sub ||
        conv.user_id_2 === auth.user.sub;

      if (!isParticipant) {
        throw forbidden("You are not a participant in this conversation");
      }

      // 2. Parse query params
      const { limit, before, beforeId } = validateSearchParams(
        req.nextUrl.searchParams,
        querySchema
      );

      // 2a. Determine message history window based on user's plan
      //     free: 90 days, plus: 180 days, pro/max: unlimited
      const { rows: planRows } = await db.query<{ plan: string }>(
        `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [auth.user.sub]
      );
      const userPlan = planRows[0]?.plan ?? "free";
      // Map plan to history limit in days (null = unlimited) — BUG-51: use parameterized query
      const PLAN_HISTORY_DAYS: Record<string, number | null> = {
        free: 90, plus: 180, pro: null, max: null,
      };
      const historyDays = PLAN_HISTORY_DAYS[userPlan] ?? 90;

      const params2: (string | number)[] = [conversationId, limit];
      let nextParam = 3;

      let cursorClause = "";
      if (before && beforeId) {
        cursorClause = `AND (m.created_at, m.id) < ($${nextParam++}, $${nextParam++})`;
        params2.push(before, beforeId);
      } else if (before) {
        cursorClause = `AND m.created_at < $${nextParam++}`;
        params2.push(before);
      }

      let historyClause = "";
      if (historyDays !== null) {
        historyClause = `AND m.created_at > NOW() - make_interval(days => $${nextParam++}::int)`;
        params2.push(historyDays);
      }

      // 3. Fetch messages with sender profile and reactions
      const { rows } = await db.query<MessageRow>(
        `SELECT
           m.id,
           m.sender_id,
           u.username AS sender_username,
           u.display_name AS sender_display_name,
           u.avatar_emoji AS sender_avatar_emoji,
           m.recipient_id,
           m.message_type,
           CASE WHEN m.is_deleted THEN NULL ELSE m.content END AS content,
           CASE WHEN m.is_deleted THEN NULL ELSE m.media_url END AS media_url,
           m.coin_cost,
           m.is_deleted,
           (
             SELECT json_agg(json_build_object(
               'id', r.id,
               'userId', r.user_id,
               'emoji', r.emoji,
               'isCustom', r.is_custom,
               'createdAt', r.created_at
             ))
             FROM message_reactions r
             WHERE r.message_id = m.id
           ) AS reactions,
           m.created_at,
           m.updated_at
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1
           ${cursorClause}
           ${historyClause}
           AND (m.message_type != 'moment' OR m.created_at > NOW() - INTERVAL '24 hours')
         ORDER BY m.created_at DESC
         LIMIT $2`,
        params2
      );

      // 4. Mark messages as read (best-effort, async)
      db.query(
        `UPDATE messages
         SET is_read = TRUE, updated_at = NOW()
         WHERE conversation_id = $1
           AND recipient_id = $2
           AND is_read = FALSE
           AND is_deleted = FALSE`,
        [conversationId, auth.user.sub]
      ).catch((err) =>
        console.error("[dm/[conversationId]:GET] Mark read failed", err)
      );

      const lastRow = rows.length === limit ? rows[rows.length - 1] : null;
      const nextCursor = lastRow
        ? { before: lastRow.created_at, beforeId: lastRow.id }
        : null;

      // 5. Check if the OTHER participant can reply (sufficient coins)
      //    and fetch their profile for the conversation metadata object
      const otherId =
        conv.user_id_1 === auth.user.sub ? conv.user_id_2 : conv.user_id_1;

      // PRD §5 — Link previews only render after recipient has replied at least twice.
      // Count messages sent by the OTHER user (the recipient from the current user's POV).
      let recipientReplyCount = 0;
      try {
        const { rows: replyCountRows } = await db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM messages
           WHERE conversation_id = $1
             AND sender_id = $2
             AND is_deleted = FALSE`,
          [conversationId, otherId]
        );
        recipientReplyCount = parseInt(replyCountRows[0]?.cnt ?? "0", 10);
      } catch {
        // Non-fatal — default to 0 (link previews disabled)
      }

      let recipientCanReply = true;
      let conversationMeta = null;
      try {
        const { rows: recipientRows } = await db.query<RecipientInfoRow>(
          `SELECT id, coin_balance, plan, username, display_name, avatar_emoji
           FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
          [otherId]
        );
        if (recipientRows[0]) {
          const r = recipientRows[0];
          const replyCost = getDMCost(r.plan as Plan, false);
          recipientCanReply = r.coin_balance >= replyCost;

          // Also compute the DM cost for the current user
          const { rows: senderRows } = await db.query<{ plan: Plan }>(
            `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 LIMIT 1`,
            [auth.user.sub]
          );
          const senderPlan = senderRows[0]?.plan ?? "free";
          const myDmCost = getDMCost(senderPlan, false);

          conversationMeta = {
            conversationId,
            participantUserId: r.id,
            participantUsername: r.username,
            participantDisplayName: r.display_name ?? r.username,
            participantAvatarEmoji: r.avatar_emoji ?? "👤",
            dmCoinCost: myDmCost > 0 ? myDmCost : null,
          };
        }
      } catch {
        // Non-fatal — default to true
      }

      return NextResponse.json(
        {
          items: rows.map((row) => ({
            ...row,
            reactions: row.reactions ? JSON.parse(row.reactions) : [],
          })),
          nextCursor: nextCursor ?? null,
          hasMore: nextCursor !== null,
          total: rows.length,
          recipientCanReply,
          otherUserId: otherId,
          // PRD §5: gate link previews until recipient has replied at least twice
          recipientReplyCount,
          linkPreviewsEnabled: recipientReplyCount >= 2,
          // conversation metadata for one-request page load
          conversation: conversationMeta,
        },
        { status: 200 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/messages/dm/[conversationId]
// ---------------------------------------------------------------------------

const sendInConversationSchema = z.object({
  content: z
    .string()
    .min(1, "Message cannot be empty")
    .max(2000, "Message cannot exceed 2000 characters")
    .optional(),
  messageType: z.enum(["text", "gif", "sticker"]).default("text"),
  mediaUrl: z.string().url().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

// Replaced by the shared RATE_LIMITS.messageSend preset (20/min) so rooms and DMs
// enforce identical limits.

interface SenderRow {
  id: string;
  plan: Plan;
  coin_balance: number;
  is_admin: boolean;
  is_verified: boolean;
  trust_score: number;
}
interface SentMessageRow {
  id: string; sender_id: string; recipient_id: string; message_type: string;
  content: string | null; media_url: string | null; coin_cost: number;
  reply_count_from_recipient: number; is_deleted: boolean;
  created_at: string; updated_at: string;
}

/**
 * Send a message inside an existing DM conversation.
 * The recipient is derived from the conversation record (no recipientId in body).
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { conversationId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.messageSend);

      const { conversationId } = params;
      const body = await validateBody(req, sendInConversationSchema);

      if (!body.content) {
        throw badRequest("content is required");
      }

      // 1. Load conversation and verify participant
      const { rows: convRows } = await db.query<{
        id: string; user_id_1: string; user_id_2: string;
      }>(
        `SELECT id, user_id_1, user_id_2 FROM dm_conversations WHERE id = $1 LIMIT 1`,
        [conversationId]
      );
      const conv = convRows[0];
      if (!conv) throw notFound("Conversation not found");

      const isParticipant =
        conv.user_id_1 === auth.user.sub || conv.user_id_2 === auth.user.sub;
      if (!isParticipant) throw forbidden("Not a participant in this conversation");

      const recipientId =
        conv.user_id_1 === auth.user.sub ? conv.user_id_2 : conv.user_id_1;

      // BUG-53: Check if recipient has blocked the sender (generic error, no block status revealed)
      const { rows: dmBlockRows } = await db.query<{ id: string }>(
        `SELECT id FROM user_blocks
         WHERE blocker_id = $1 AND blocked_id = $2
         LIMIT 1`,
        [recipientId, auth.user.sub]
      );

      // 2. Load sender
      const { rows: senderRows } = await db.query<SenderRow>(
        `SELECT id, plan, coin_balance, is_admin,
                COALESCE(is_verified, false) AS is_verified,
                COALESCE(trust_score, 50)    AS trust_score
         FROM users
         WHERE id = $1 AND deleted_at IS NULL AND is_suspended = FALSE
         LIMIT 1`,
        [auth.user.sub]
      );
      const sender = senderRows[0];
      if (!sender) throw forbidden("Your account cannot send messages");

      // BUG-53: Enforce block check now that we know sender.is_admin
      if (dmBlockRows[0] && !sender.is_admin) {
        throw badRequest("Unable to send message to this user", "MESSAGE_NOT_DELIVERED");
      }

      // 3. Daily reply limit
      const daily = await checkDailyLimitReached(auth.user.sub, sender.plan);
      if (daily.replyLimitReached) {
        throw conflict("Daily reply limit reached. Try again tomorrow.", "DAILY_LIMIT_REACHED");
      }

      // 4. Coin cost (always a reply since conversation exists)
      const coinCost = getDMCost(sender.plan, false);
      if (coinCost > 0 && sender.coin_balance < coinCost && !sender.is_admin) {
        throw conflict(`Insufficient coins. This message costs ${coinCost} coin(s).`, "INSUFFICIENT_COINS");
      }

      // 5. Count recipient replies (for anti-spam threshold)
      const { rows: replyRows } = await db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM messages
         WHERE conversation_id = $1 AND sender_id = $2 AND is_deleted = FALSE`,
        [conversationId, recipientId]
      );
      const replyCountFromRecipient = parseInt(replyRows[0]?.cnt ?? "0", 10);

      // 6. Anti-spam filter (silent)
      const filtered = filterDMContent(body.content, replyCountFromRecipient, sender.is_admin);
      if (!sender.is_admin && body.content.trim() && !filtered.trim()) {
        return NextResponse.json(
          {
            message: {
              id: `blocked-${Date.now()}`,
              sender_id: auth.user.sub,
              recipient_id: recipientId,
              message_type: body.messageType,
              content: body.content,
              media_url: body.mediaUrl ?? null,
              coin_cost: 0,
              is_deleted: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          },
          { status: 201 }
        );
      }

      // BUG-52: Ensure filtered content is never null/empty before persisting
      const finalContent = filtered.trim() || "[Message removed by content filter]";

      // 7. Bot/duplicate automod (same checks as room messages)
      if (!sender.is_admin && body.messageType === "text" && filtered.trim()) {
        const modResult = await applyAutoModeration(
          { content: filtered, senderId: auth.user.sub, roomId: conversationId },
          { id: conversationId },
          { id: auth.user.sub, is_verified: sender.is_verified, trust_score: sender.trust_score },
          db
        );
        if (modResult.blocked) {
          throw badRequest(
            modResult.reason === "bot_behavior"
              ? "Message blocked: unusual sending velocity detected"
              : "Message blocked: duplicate content detected"
          );
        }
      }

      // 8. Idempotency check
      if (body.idempotencyKey) {
        const { rows: dupRows } = await db.query<{ id: string }>(
          `SELECT id FROM messages WHERE sender_id = $1 AND idempotency_key = $2 LIMIT 1`,
          [auth.user.sub, body.idempotencyKey]
        );
        if (dupRows[0]) {
          const { rows: existingRows } = await db.query<SentMessageRow>(
            `SELECT id, sender_id, recipient_id, message_type, content, media_url,
                    coin_cost, reply_count_from_recipient, is_deleted, created_at, updated_at
             FROM messages WHERE id = $1 LIMIT 1`,
            [dupRows[0].id]
          );
          return NextResponse.json({ message: existingRows[0] }, { status: 200 });
        }
      }

      // 9. Atomic: deduct coins + create message
      const message = await db.transaction(async (tx) => {
        if (coinCost > 0 && !sender.is_admin) {
          const { rows: deductRows } = await tx.query<{ coin_balance: number }>(
            `UPDATE users SET coin_balance = coin_balance - $1, updated_at = NOW()
             WHERE id = $2 AND coin_balance >= $1 AND deleted_at IS NULL
             RETURNING coin_balance`,
            [coinCost, auth.user.sub]
          );
          if (!deductRows[0]) throw conflict("Insufficient coins", "INSUFFICIENT_COINS");

          await tx.query(
            `INSERT INTO coin_ledger
               (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description)
             VALUES ($1, $2, $3, $4, 'dm_cost', NULL, 'DM coin cost')`,
            [auth.user.sub, -coinCost, sender.coin_balance, deductRows[0].coin_balance]
          );
        }

        const { rows: msgRows } = await tx.query<SentMessageRow>(
          `INSERT INTO messages
             (sender_id, recipient_id, conversation_id, message_type, content,
              media_url, coin_cost, reply_count_from_recipient, idempotency_key, sender_plan_at_creation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, sender_id, recipient_id, message_type, content, media_url,
                     coin_cost, reply_count_from_recipient, is_deleted, created_at, updated_at`,
          [
            auth.user.sub, recipientId, conversationId, body.messageType,
            finalContent, body.mediaUrl ?? null, coinCost,
            replyCountFromRecipient, body.idempotencyKey ?? null, sender.plan,
          ]
        );

        return msgRows[0];
      });

      if (!message) throw new Error("Message creation failed");

      // 10. XP + daily counter (best-effort, outside transaction) — apply plan multiplier per PRD §6
      {
        const { baseXp: convBaseXp, finalXp: convFinalXp } = calculateFinalXP(
          'send_text_message',
          { plan: sender.plan, isMessagingAction: true }
        );
        const convMultiplierBP = PLAN_XP_MULTIPLIERS_BP[sender.plan];
        db.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, multiplier, base_amount)
             VALUES ($1, $2, 'social', 'message', $3, $4, $5)`,
            [auth.user.sub, convFinalXp, message.id, convMultiplierBP, convBaseXp]
          );
          await tx.query(
            `UPDATE users SET xp_total = xp_total + $1, xp_social = xp_social + $1, updated_at = NOW()
             WHERE id = $2`,
            [convFinalXp, auth.user.sub]
          );
        }).catch((err) => console.error('[dm/xp] XP award failed', err));
      }
      incrementDailyCount(auth.user.sub, "reply").catch(() => {});
      updateConversationScore(auth.user.sub, recipientId, "message_sent").catch(() => {});

      // 11. Realtime broadcast — push the new message to open clients
      publishRealtimeEvent(
        `dm:conversation:${conversationId}`,
        "new_message",
        { message }
      ).catch(() => {});

      return NextResponse.json({ message }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
