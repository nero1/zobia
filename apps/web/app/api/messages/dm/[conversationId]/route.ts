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
import { randomUUID } from "crypto";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateSearchParams, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDMCost, checkAndIncrementDailyCount } from "@/lib/messaging/coinCost";
import { filterDMContent } from "@/lib/messaging/antispam";
import { applyAutoModeration } from "@/lib/moderation/contentFilter";
import { updateConversationScore } from "@/lib/messaging/conversationScore";
import { debitCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { publishRealtimeEvent } from "@/lib/realtime";
import { notifyDirectMessage } from "@/lib/notifications/chatPush";
import { calculateFinalXP } from "@/lib/xp/engine";
import type { Plan } from "@zobia/types";
import { logger } from "@/lib/logger";

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
  /**
   * Delta fetch: when set to an ISO timestamp, return only messages at/after it
   * (ascending). The live poll uses this to fetch just new messages; boundary
   * rows may repeat and are deduped client-side by id.
   */
  after: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

type MessageRow = Record<string, unknown> & {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_display_name: string;
  sender_avatar_emoji: string;
  recipient_id: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  coin_cost: string | number | null;
  is_deleted: boolean;
  reactions: string | null;
  created_at: string;
  updated_at: string;
};

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
      const orm = await getDb();

      // 1. Verify the conversation exists and the user is a participant
      const [conv] = await orm
        .select({ userId1: schema.dmConversations.userId1, userId2: schema.dmConversations.userId2 })
        .from(schema.dmConversations)
        .where(eq(schema.dmConversations.id, conversationId))
        .limit(1);

      if (!conv) throw notFound("Conversation not found");

      const isParticipant =
        conv.userId1 === auth.user.sub ||
        conv.userId2 === auth.user.sub;

      if (!isParticipant) {
        throw forbidden("You are not a participant in this conversation");
      }

      // 2. Parse query params
      const { limit, before, beforeId, after } = validateSearchParams(
        req.nextUrl.searchParams,
        querySchema
      );
      const deltaMode = !!after;

      // 2a. Determine message history window based on user's plan
      //     free: 90 days, plus: 180 days, pro/max: unlimited
      const [planRow] = await orm
        .select({ plan: schema.users.plan })
        .from(schema.users)
        .where(and(eq(schema.users.id, auth.user.sub), sql`${schema.users.deletedAt} IS NULL`))
        .limit(1);
      const userPlan = planRow?.plan ?? "free";
      // Map plan to history limit in days (null = unlimited) — BUG-51: use parameterized query
      const PLAN_HISTORY_DAYS: Record<string, number | null> = {
        free: 90, plus: 180, pro: null, max: null,
      };
      const historyDays = PLAN_HISTORY_DAYS[userPlan] ?? 90;

      // Delta mode takes precedence: only messages newer than `after`, ascending.
      let cursorClause = sql``;
      if (deltaMode) {
        cursorClause = sql`AND m.created_at >= ${after}::timestamptz`;
      } else if (before && beforeId) {
        cursorClause = sql`AND (m.created_at, m.id) < (${before}::timestamptz, ${beforeId}::uuid)`;
      } else if (before) {
        cursorClause = sql`AND m.created_at < ${before}::timestamptz`;
      }

      const historyClause = historyDays !== null
        ? sql`AND m.created_at > NOW() - make_interval(days => ${historyDays}::int)`
        : sql``;

      // 3. Fetch messages with sender profile and reactions
      const result = await orm.execute<MessageRow>(sql`
        SELECT
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
          COALESCE(
            (
              SELECT json_agg(json_build_object(
                'id', r.id,
                'userId', r.user_id,
                'emoji', r.emoji,
                'isCustom', r.is_custom,
                'createdAt', r.created_at
              ) ORDER BY r.created_at)
              FROM message_reactions r
              WHERE r.message_id = m.id
            ),
            '[]'::json
          ) AS reactions,
          m.created_at,
          m.updated_at
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ${conversationId}
          ${cursorClause}
          ${historyClause}
          AND (m.message_type != 'moment' OR m.created_at > NOW() - INTERVAL '24 hours')
        ORDER BY m.created_at ${deltaMode ? sql`ASC` : sql`DESC`}
        LIMIT ${limit}
      `);
      const rows = result.rows;

      // 4. Mark messages as read (best-effort, async)
      void (async () => {
        try {
          await orm
            .update(schema.messages)
            .set({ isRead: true, updatedAt: sql`NOW()` })
            .where(and(
              eq(schema.messages.conversationId, conversationId),
              eq(schema.messages.recipientId, auth.user.sub),
              eq(schema.messages.isRead, false),
              eq(schema.messages.isDeleted, false),
            ));
        } catch (err) {
          logger.error({ err: err }, "[dm/[conversationId]:GET] Mark read failed");
        }
      })();

      // Cursor pagination only applies to the backlog query, not delta polling.
      const lastRow = !deltaMode && rows.length === limit ? rows[rows.length - 1] : null;
      const nextCursor = lastRow
        ? { before: lastRow.created_at, beforeId: lastRow.id }
        : null;

      // 5. Check if the OTHER participant can reply (sufficient coins)
      //    and fetch their profile for the conversation metadata object
      const otherId =
        conv.userId1 === auth.user.sub ? conv.userId2 : conv.userId1;

      // PRD §5 — Link previews only render after recipient has replied at least twice.
      // Count messages sent by the OTHER user (the recipient from the current user's POV).
      let recipientReplyCount = 0;
      try {
        const [{ count }] = await orm
          .select({ count: sql<string>`COUNT(*)` })
          .from(schema.messages)
          .where(and(
            eq(schema.messages.conversationId, conversationId),
            eq(schema.messages.senderId, otherId),
            eq(schema.messages.isDeleted, false),
          ));
        recipientReplyCount = parseInt(count ?? "0", 10);
      } catch {
        // Non-fatal — default to 0 (link previews disabled)
      }

      let recipientCanReply = true;
      let conversationMeta = null;
      try {
        const [recipient] = await orm
          .select({
            id: schema.users.id,
            coinBalance: schema.users.coinBalance,
            plan: schema.users.plan,
            username: schema.users.username,
            displayName: schema.users.displayName,
            avatarEmoji: schema.users.avatarEmoji,
          })
          .from(schema.users)
          .where(and(eq(schema.users.id, otherId), sql`${schema.users.deletedAt} IS NULL`))
          .limit(1);
        if (recipient) {
          const replyCost = getDMCost(recipient.plan as Plan, false) ?? 0;
          recipientCanReply = recipient.coinBalance >= BigInt(replyCost);

          // Also compute the DM cost for the current user
          const [senderRow] = await orm
            .select({ plan: schema.users.plan })
            .from(schema.users)
            .where(eq(schema.users.id, auth.user.sub))
            .limit(1);
          const senderPlan = senderRow?.plan ?? "free";
          const myDmCost = getDMCost(senderPlan as Plan, false) ?? 0;

          conversationMeta = {
            conversationId,
            participantUserId: recipient.id,
            participantUsername: recipient.username,
            participantDisplayName: recipient.displayName ?? recipient.username,
            participantAvatarEmoji: recipient.avatarEmoji ?? "👤",
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

      const orm = await getDb();

      // 1. Load conversation and verify participant
      const [conv] = await orm
        .select({ id: schema.dmConversations.id, userId1: schema.dmConversations.userId1, userId2: schema.dmConversations.userId2 })
        .from(schema.dmConversations)
        .where(eq(schema.dmConversations.id, conversationId))
        .limit(1);
      if (!conv) throw notFound("Conversation not found");

      const isParticipant =
        conv.userId1 === auth.user.sub || conv.userId2 === auth.user.sub;
      if (!isParticipant) throw forbidden("Not a participant in this conversation");

      const recipientId =
        conv.userId1 === auth.user.sub ? conv.userId2 : conv.userId1;

      // BUG-53: Check if recipient has blocked the sender (generic error, no block status revealed)
      const [dmBlock] = await orm
        .select({ id: schema.userBlocks.id })
        .from(schema.userBlocks)
        .where(and(eq(schema.userBlocks.blockerId, recipientId), eq(schema.userBlocks.blockedId, auth.user.sub)))
        .limit(1);

      // 2. Load sender
      const [sender] = await orm
        .select({
          id: schema.users.id,
          plan: schema.users.plan,
          coinBalance: schema.users.coinBalance,
          isAdmin: schema.users.isAdmin,
          isVerified: schema.users.isVerified,
          trustScore: schema.users.trustScore,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatarEmoji: schema.users.avatarEmoji,
        })
        .from(schema.users)
        .where(and(
          eq(schema.users.id, auth.user.sub),
          sql`${schema.users.deletedAt} IS NULL`,
          eq(schema.users.isSuspended, false),
        ))
        .limit(1);
      if (!sender) throw forbidden("Your account cannot send messages");

      // BUG-53: Enforce block check now that we know sender.is_admin
      if (dmBlock && !sender.isAdmin) {
        throw badRequest("Unable to send message to this user", "MESSAGE_NOT_DELIVERED");
      }

      // 3. Atomic daily reply limit check + increment — single Lua round-trip
      //    eliminates the TOCTOU race between a separate read-check and a later
      //    write-increment (BUG-10). Placed before the DB transaction so a
      //    rolled-back transaction never leaks a Redis counter increment.
      const { allowed: replyAllowed } = await checkAndIncrementDailyCount(
        auth.user.sub, "reply", sender.plan as Plan
      );
      if (!replyAllowed) {
        throw conflict("Daily reply limit reached. Try again tomorrow.", "DAILY_LIMIT_REACHED");
      }

      // 4. Coin cost (always a reply since conversation exists)
      const coinCost = getDMCost(sender.plan as Plan, false) ?? 0;
      if (coinCost > 0 && sender.coinBalance < BigInt(coinCost) && !sender.isAdmin) {
        throw conflict(`Insufficient coins. This message costs ${coinCost} coin(s).`, "INSUFFICIENT_COINS");
      }

      // 5. Count recipient replies (for anti-spam threshold)
      const [{ count: replyCountStr }] = await orm
        .select({ count: sql<string>`COUNT(*)` })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.senderId, recipientId),
          eq(schema.messages.isDeleted, false),
        ));
      const replyCountFromRecipient = parseInt(replyCountStr ?? "0", 10);

      // 6. Anti-spam filter
      const filtered = filterDMContent(body.content, replyCountFromRecipient, sender.isAdmin);
      if (!sender.isAdmin && body.content.trim() && !filtered.trim()) {
        return NextResponse.json(
          { error: "Message blocked by content filter", code: "CONTENT_FILTERED" },
          { status: 422 }
        );
      }

      // BUG-52: Ensure filtered content is never null/empty before persisting
      const finalContent = filtered.trim() || "[Message removed by content filter]";

      // 7. Bot/duplicate automod (same checks as room messages)
      if (!sender.isAdmin && body.messageType === "text" && filtered.trim()) {
        const modResult = await applyAutoModeration(
          { content: filtered, senderId: auth.user.sub, roomId: conversationId },
          { id: conversationId },
          { id: auth.user.sub, is_verified: sender.isVerified ?? false, trust_score: sender.trustScore ?? 50 },
          orm,
          "dm"
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
        const [dup] = await orm
          .select({ id: schema.messages.id })
          .from(schema.messages)
          .where(and(eq(schema.messages.senderId, auth.user.sub), eq(schema.messages.idempotencyKey, body.idempotencyKey)))
          .limit(1);
        if (dup) {
          const [existing] = await orm.select().from(schema.messages).where(eq(schema.messages.id, dup.id)).limit(1);
          return NextResponse.json(
            { message: existing ? { ...existing, coinCost: Number(existing.coinCost ?? 0) } : existing },
            { status: 200 }
          );
        }
      }

      // Always generate a non-null coinRefId so the coin ledger has a unique reference
      // that prevents double-debit under concurrent retries (BUG-M-02).
      // When the client provides an idempotency key we use it for true retry idempotency;
      // otherwise we generate a random UUID scoped to this request.
      const coinRefId = `dm_cost:${body.idempotencyKey ?? randomUUID()}`;

      // 9. Atomic: deduct coins + create message
      const message = await orm.transaction(async (tx) => {
        if (coinCost > 0 && !sender.isAdmin) {
          try {
            await debitCoins(
              auth.user.sub,
              coinCost,
              'dm_cost',
              coinRefId,
              'DM coin cost',
              null,
              tx
            );
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'INSUFFICIENT_BALANCE') {
              throw conflict("Insufficient coins", "INSUFFICIENT_COINS");
            }
            throw err;
          }
        }

        const [inserted] = await tx
          .insert(schema.messages)
          .values({
            senderId: auth.user.sub,
            recipientId,
            conversationId,
            messageType: body.messageType,
            content: finalContent,
            mediaUrl: body.mediaUrl ?? null,
            coinCost: BigInt(coinCost),
            replyCountFromRecipient,
            idempotencyKey: body.idempotencyKey ?? null,
            senderPlanAtCreation: sender.plan,
          })
          .returning();

        return inserted;
      });

      if (!message) throw new Error("Message creation failed");

      // Attach the sender's public profile so the HTTP response and the realtime
      // echo carry everything the UI needs to render the bubble immediately
      // (sender name + avatar). Without these, recipients saw "@undefined" with
      // no avatar until the next poll reconciled.
      const enrichedMessage = {
        ...message,
        // coinCost is a bigint column — convert for JSON serialization (JSON.stringify throws on bigint).
        coinCost: Number(message.coinCost ?? 0),
        sender_username: sender.username,
        sender_display_name: sender.displayName ?? sender.username,
        sender_avatar_emoji: sender.avatarEmoji ?? "👤",
      };

      // 10. XP + daily counter (best-effort, outside transaction) — apply plan multiplier per PRD §6
      {
        const { finalXp: convFinalXp } = calculateFinalXP(
          'send_text_message',
          { plan: sender.plan as Plan, isMessagingAction: true }
        );
        // BUG-XP-11: use safeAwardXP with message.id as reference_id for idempotency + DLQ on failure
        safeAwardXP(auth.user.sub, convFinalXp, 'social', 'message', `dm_${message.id}`).catch(() => {});
      }
      updateConversationScore(auth.user.sub, recipientId, "message_sent").catch(() => {});

      // 11. Realtime broadcast — push the new message to open clients
      publishRealtimeEvent(
        `dm:conversation:${conversationId}`,
        "new_message",
        { message: enrichedMessage }
      ).catch(() => {});

      // 12. Push notification — only if the recipient is not currently online.
      void notifyDirectMessage({
        recipientId,
        senderName: sender.displayName ?? sender.username,
        text: finalContent,
        conversationId,
      });

      return NextResponse.json({ message: enrichedMessage }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
