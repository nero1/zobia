export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/messages/route.ts
 *
 * Room message feed endpoints.
 *
 * GET /api/rooms/:roomId/messages
 *   Paginated message feed (newest first, cursor-based).
 *   Caller must be an active room member (or creator).
 *   VIP rooms: non-subscribers receive last 3 messages only.
 *
 * POST /api/rooms/:roomId/messages
 *   Send a message to the room.
 *   - Anti-spam: strips links, phone numbers, emails unless sender is admin/co-mod.
 *   - Awards 2 XP per message (capped at 50 messages/day).
 *   - Increments room's total_messages counter.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, SqlParam } from "@/lib/db";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { filterPublicContent } from "@/lib/messaging/antispam";
import { applyAutoModeration } from "@/lib/moderation/contentFilter";
import { ROOM_MESSAGE_XP_DAILY_CAP, calculateFinalXP } from "@/lib/xp/engine";
import { safeAwardXP } from "@/lib/xp/safeAwardXP"; // BUG-PERF-12: static import (was dynamic inside maybeAwardMessageXP)
import type { Plan } from "@zobia/types";
import { publishRealtimeEvent } from "@/lib/realtime";
import { notifyRoomMentions, parseMentions } from "@/lib/notifications/chatPush";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  /**
   * Delta fetch: when set to an ISO timestamp, return only messages at/after it
   * (ascending). Lets the live poll fetch just new messages instead of the whole
   * snapshot — far cheaper on serverless + DB. Boundary rows may repeat and are
   * deduped client-side by id.
   */
  after: z.string().datetime().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 30)),
});

const sendMessageSchema = z.object({
  content: z
    .string()
    .min(1, "Message cannot be empty")
    .max(2000, "Message cannot exceed 2000 characters"),
  // 'moment' = ephemeral 24-hour message (PRD §5 — Zobia Moments)
  messageType: z
    .enum(["text", "sticker", "gif", "gift", "system", "moment"])
    .default("text"),
  metadata: z.record(z.unknown()).optional(),
  replyToMessageId: z.string().uuid().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

// ---------------------------------------------------------------------------
// DB row types and client-facing shape
// ---------------------------------------------------------------------------

// Client-facing message shape (camelCase, matches room page Message interface)
interface Message {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  senderIsCreator: boolean;
  content: string;
  createdAt: string;
  message_type: string;
  giftEmoji?: string;
  giftAmount?: number;
  isPinned?: boolean;
  pinnedAt?: string | null;
  pinExpiresAt?: string | null;
}

function rowToMessage(row: MessageRow): Message {
  const meta = (row.metadata as Record<string, unknown> | null) ?? {};
  return {
    id: row.id,
    userId: row.sender_id,
    username: row.sender_username,
    displayName: row.sender_display_name ?? row.sender_username,
    avatarEmoji: row.sender_avatar_emoji,
    senderIsCreator: Boolean(row.sender_is_creator),
    content: row.content ?? "",
    createdAt: row.created_at,
    message_type: row.message_type,
    giftEmoji: typeof meta.giftEmoji === "string" ? meta.giftEmoji : undefined,
    giftAmount: typeof meta.giftAmount === "number" ? meta.giftAmount : undefined,
    isPinned: row.is_pinned && (!row.pin_expires_at || new Date(row.pin_expires_at) > new Date()),
    pinnedAt: row.pinned_at ?? null,
    pinExpiresAt: row.pin_expires_at ?? null,
  };
}

interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  sender_username: string;
  sender_display_name: string;
  sender_avatar_emoji: string;
  sender_is_creator: boolean;
  content: string | null;
  message_type: string;
  metadata: unknown | null;
  reply_to_message_id: string | null;
  is_deleted: boolean;
  created_at: string;
  is_pinned: boolean;
  pinned_at: string | null;
  pin_expires_at: string | null;
}

interface MemberRow {
  role: string;
  is_muted: boolean;
  muted_until: string | null;
  left_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve caller's membership details for the given room.
 * Returns null if the user is not a member.
 */
async function getCallerMembership(
  roomId: string,
  userId: string
): Promise<MemberRow | null> {
  const { rows } = await db.query<MemberRow>(
    `SELECT role, is_muted, muted_until, left_at
     FROM room_members
     WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId]
  );
  return rows[0] ?? null;
}

/**
 * Count how many messages the user has sent in this room today (for XP cap).
 */
async function countTodayMessages(roomId: string, userId: string): Promise<number> {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt
     FROM room_messages
     WHERE room_id = $1
       AND sender_id = $2
       AND is_pending_approval = FALSE
       AND created_at >= CURRENT_DATE`,
    [roomId, userId]
  );
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

/**
 * Award XP to the sender if they have not yet hit the daily 50-message cap.
 * Applies the user's plan multiplier per PRD §6.
 * Silently swallows errors.
 *
 * @param messageId       - The newly inserted message UUID (used as reference_id for idempotency)
 * @param userId          - Sender UUID
 * @param todayMsgCount   - How many messages they have already sent today
 * @param plan            - The sender's current plan (for multiplier)
 */
async function maybeAwardMessageXP(
  messageId: string,
  userId: string,
  todayMsgCount: number,
  plan: Plan
): Promise<number> {
  if (todayMsgCount >= ROOM_MESSAGE_XP_DAILY_CAP) return 0;
  try {
    const { finalXp } = calculateFinalXP(
      'send_room_message',
      { plan, isMessagingAction: true }
    );
    await safeAwardXP(userId, finalXp, "social", "send_message", `msg_${messageId}`);
    return finalXp;
  } catch (err) {
    console.error("[rooms/messages] XP award failed (non-fatal):", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// GET /api/rooms/[roomId]/messages
// ---------------------------------------------------------------------------

/**
 * Retrieve a paginated list of room messages, newest first.
 *
 * Access rules:
 *  - Caller must be a member (or creator) of the room.
 *  - VIP rooms: non-subscribers receive at most the last 3 messages.
 *
 * @param req    - Incoming request with optional cursor and limit query params
 * @param params - Route params containing roomId
 * @returns Paginated messages list with nextCursor
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;

    // Fetch room
    const { rows: roomRows } = await db.query<{
      type: string;
      creator_id: string;
      is_active: boolean;
      is_suspended: boolean;
      is_banned: boolean;
    }>(
      `SELECT type, creator_id, is_active,
              COALESCE(is_suspended, FALSE) AS is_suspended,
              COALESCE(is_banned, FALSE) AS is_banned
       FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");
    if (room.is_banned) throw forbidden("This room has been permanently banned");
    if (room.is_suspended) throw forbidden("This room is currently suspended");

    const isCreator = room.creator_id === userId;
    const membership = await getCallerMembership(roomId, userId);
    const isMember = membership !== null;

    // Non-member, non-creator access check (VIP gets 3 messages preview)
    if (!isMember && !isCreator && room.type !== "vip") {
      throw forbidden("You must be a member to read messages in this room");
    }

    const queryParams = validateSearchParams(
      req.nextUrl.searchParams,
      listMessagesQuerySchema
    );

    // VIP non-subscriber gets only 3 messages
    let limit = queryParams.limit;
    if (room.type === "vip" && !isMember && !isCreator) {
      limit = 3;
    }

    const conditions: string[] = [
      "m.room_id = $1",
      "m.is_deleted = FALSE",
      // Moments expire after 24 hours (PRD §5 — Zobia Moments)
      "(m.message_type != 'moment' OR m.created_at > NOW() - INTERVAL '24 hours')",
      // Hide messages awaiting moderator approval (BUG-RM01)
      "(m.is_pending_approval = FALSE OR m.is_pending_approval IS NULL)",
    ];
    const queryArgs: SqlParam[] = [roomId];
    let paramIdx = 2;

    // Delta mode takes precedence over cursor pagination: return only messages
    // newer than the client's latest known timestamp, oldest-first.
    const deltaMode = !!queryParams.after;
    if (deltaMode) {
      conditions.push(`m.created_at >= $${paramIdx}::timestamptz`);
      queryArgs.push(queryParams.after as string);
      paramIdx += 1;
    } else if (queryParams.cursor) {
      // Parse compound cursor: "ISO_TIMESTAMP__UUID"
      const parts = queryParams.cursor.split('__');
      const cursorTs = parts[0] ?? null;
      const cursorId = parts[1] ?? null;
      if (cursorTs && cursorId) {
        conditions.push(`(m.created_at, m.id) < ($${paramIdx}::timestamptz, $${paramIdx + 1}::uuid)`);
        queryArgs.push(cursorTs);
        queryArgs.push(cursorId);
        paramIdx += 2;
      }
    }

    queryArgs.push(limit);
    const limitParam = paramIdx;

    const orderClause = deltaMode
      ? "m.created_at ASC"
      : "(m.is_pinned AND (m.pin_expires_at IS NULL OR m.pin_expires_at > NOW())) DESC NULLS LAST, m.created_at DESC";

    const { rows: messages } = await db.query<MessageRow>(
      `SELECT
         m.id,
         m.room_id,
         m.sender_id,
         u.username        AS sender_username,
         u.display_name    AS sender_display_name,
         u.avatar_emoji    AS sender_avatar_emoji,
         u.is_creator      AS sender_is_creator,
         m.content,
         m.message_type,
         m.metadata,
         m.reply_to_message_id,
         m.is_deleted,
         -- Treat coin-purchased pins as unpinned once pin_expires_at has passed.
         -- Legacy moderator pins (pin_expires_at IS NULL) are permanent.
         COALESCE(m.is_pinned AND (m.pin_expires_at IS NULL OR m.pin_expires_at > NOW()), false) AS is_pinned,
         m.pinned_at,
         m.pin_expires_at,
         m.created_at
       FROM room_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderClause}
       LIMIT $${limitParam}`,
      queryArgs
    );

    // Cursor pagination only applies to the backlog query, not delta polling.
    const lastMsg = messages[messages.length - 1];
    const nextCursor = !deltaMode && messages.length === limit && lastMsg
      ? `${lastMsg.created_at}__${lastMsg.id}`
      : null;

    return NextResponse.json(
      { items: messages.map(rowToMessage), nextCursor, hasMore: nextCursor !== null },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/messages
// ---------------------------------------------------------------------------

/**
 * Send a message to a room.
 *
 * Anti-spam: strips links, phone numbers, and email addresses from content
 * unless the sender is a room admin or co-moderator.
 *
 * XP: Awards 2 XP per message, capped at 50 messages/day.
 *
 * @param req    - Incoming request with message JSON body
 * @param params - Route params containing roomId
 * @returns Created message object with status 201
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.messageSend);

    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;
    let body = await validateBody(req, sendMessageSchema);

    // Fetch room (including moderation_rules for automod enforcement)
    const { rows: roomRows } = await db.query<{
      type: string;
      creator_id: string;
      is_active: boolean;
      is_suspended: boolean;
      is_banned: boolean;
      moderation_rules: unknown;
    }>(
      `SELECT type, creator_id, is_active,
              COALESCE(is_suspended, FALSE) AS is_suspended,
              COALESCE(is_banned, FALSE) AS is_banned,
              moderation_rules
       FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");
    if (room.is_banned) throw forbidden("This room has been permanently banned");
    if (room.is_suspended) throw forbidden("This room is currently suspended");

    const isCreator = room.creator_id === userId;

    // Verify membership
    const membership = await getCallerMembership(roomId, userId);
    if (!membership && !isCreator) {
      throw forbidden("You must be a member to send messages in this room");
    }

    // Kicked members (left_at is set) cannot post
    if (membership && (membership as unknown as { left_at: string | null }).left_at) {
      throw forbidden("You have been removed from this room");
    }

    // Check account-level suspension or ban before allowing any post.
    // Also fetch profile fields here so we can build the realtime payload later
    // without an extra round-trip.
    const { rows: senderStatusRows } = await db.query<{
      username: string;
      avatar_emoji: string;
      is_creator: boolean;
      is_suspended: boolean;
      is_banned: boolean;
      suspended_until: string | null;
      plan: Plan;
    }>(
      `SELECT username, avatar_emoji,
              COALESCE(is_creator, false) AS is_creator,
              COALESCE(is_suspended, false) AS is_suspended,
              COALESCE(is_banned, false) AS is_banned,
              suspended_until,
              COALESCE(plan, 'free') AS plan
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const senderStatus = senderStatusRows[0];
    if (senderStatus?.is_banned) {
      throw forbidden("Your account has been banned");
    }
    if (senderStatus?.is_suspended) {
      const until = senderStatus.suspended_until ? new Date(senderStatus.suspended_until) : null;
      if (!until || until > new Date()) {
        throw forbidden("Your account is currently suspended");
      }
    }

    // Build the camelCase client message shape shared by the idempotency
    // short-circuit, the HTTP response, and the realtime broadcast. Keeping a
    // single shape here guarantees the sender, web SSE/poll consumers, and the
    // Expo client all receive identical fields (fixes blank "@undefined"
    // bubbles that appeared when the raw snake_case DB row was returned).
    const toClientMessage = (
      row: { id: string; sender_id: string; message_type: string; created_at: string; metadata?: unknown | null },
      msgContent: string
    ): Message => {
      const meta = (row.metadata as Record<string, unknown> | null) ?? {};
      return {
        id: row.id,
        userId: row.sender_id,
        username: senderStatus?.username ?? "",
        displayName: senderStatus?.username ?? "",
        avatarEmoji: senderStatus?.avatar_emoji ?? "👤",
        senderIsCreator: Boolean(senderStatus?.is_creator),
        content: msgContent ?? "",
        createdAt: row.created_at,
        message_type: row.message_type,
        giftEmoji: typeof meta.giftEmoji === "string" ? meta.giftEmoji : undefined,
        giftAmount: typeof meta.giftAmount === "number" ? meta.giftAmount : undefined,
      };
    };

    // Mute check
    if (membership) {
      const mutedUntil = membership.muted_until
        ? new Date(membership.muted_until)
        : null;
      if (
        membership.is_muted &&
        (mutedUntil === null || mutedUntil > new Date())
      ) {
        throw forbidden("You are muted in this room");
      }
    }

    const isAdmin =
      isCreator ||
      membership?.role === "creator" ||
      membership?.role === "admin" ||
      membership?.role === "co_moderator";

    // ── Automod rule enforcement (PRD §10) ────────────────────────────────
    // Parse moderation_rules JSONB stored on the room record.
    const modRules = (room.moderation_rules as Record<string, unknown> | null) ?? {};

    if (!isAdmin) {
      // Slow-mode: enforce minimum gap between the user's last two messages
      const slowModeSecs = Number(modRules.slowModeSeconds ?? 0);
      if (slowModeSecs > 0) {
        const { rows: lastMsgRows } = await db.query<{ created_at: string }>(
          `SELECT created_at FROM room_messages
           WHERE room_id = $1 AND sender_id = $2 AND is_deleted = FALSE
           ORDER BY created_at DESC LIMIT 1`,
          [roomId, userId]
        );
        if (lastMsgRows[0]) {
          const secondsSinceLast =
            (Date.now() - new Date(lastMsgRows[0].created_at).getTime()) / 1000;
          if (secondsSinceLast < slowModeSecs) {
            throw badRequest(
              `Slow mode is active. Wait ${Math.ceil(slowModeSecs - secondsSinceLast)} seconds.`
            );
          }
        }
      }

      // New-member posting hold: users who joined within N hours cannot post
      const holdHours = Number(modRules.newMemberPostHoldHours ?? 0);
      if (holdHours > 0 && membership) {
        const { rows: joinRows } = await db.query<{ joined_at: string }>(
          `SELECT joined_at FROM room_members WHERE room_id = $1 AND user_id = $2`,
          [roomId, userId]
        );
        if (joinRows[0]) {
          const hoursSinceJoin =
            (Date.now() - new Date(joinRows[0].joined_at).getTime()) / 3_600_000;
          if (hoursSinceJoin < holdHours) {
            throw forbidden(
              `New members must wait ${holdHours} hour${holdHours !== 1 ? "s" : ""} before posting.`
            );
          }
        }
      }

      // Approval-required: message goes into a pending queue instead of appearing directly
      // (We still insert it, but mark it pending; moderators review via /moderation endpoint)
      // Note: require_approval is soft — message is stored but hidden until approved.
    }

    // Per-room message-type allow list (stored in moderation_rules.allowedMessageTypes)
    // e.g. ["text","sticker"] — if set, only those types are accepted (admins bypass)
    const allowedTypes = Array.isArray(modRules.allowedMessageTypes)
      ? (modRules.allowedMessageTypes as string[])
      : null;
    if (!isAdmin && allowedTypes && allowedTypes.length > 0) {
      if (!allowedTypes.includes(body.messageType)) {
        throw badRequest(
          `Message type '${body.messageType}' is not allowed in this room. ` +
          `Allowed types: ${allowedTypes.join(", ")}.`
        );
      }
    }

    // Layer-1 auto-moderation: bot detection, duplicate detection, profanity filter
    if (!isAdmin && body.messageType === "text") {
      const { rows: senderRows } = await db.query<{ is_verified: boolean; trust_score: number }>(
        `SELECT is_verified, COALESCE(trust_score, 50) AS trust_score FROM users WHERE id = $1`,
        [userId]
      );
      const sender = senderRows[0] ?? { is_verified: false, trust_score: 50 };
      const modResult = await applyAutoModeration(
        { content: body.content, senderId: userId, roomId },
        { id: roomId },
        { id: userId, is_verified: sender.is_verified, trust_score: sender.trust_score },
        db
      );
      if (modResult.blocked) {
        throw badRequest(
          modResult.reason === "bot_behavior"
            ? "Message blocked: unusual sending velocity detected"
            : modResult.reason === "duplicate_message"
              ? "Message blocked: duplicate content detected"
              : "Message blocked by content filter"
        );
      }
      // Use filtered content (profanity replaced with asterisks)
      body = { ...body, content: modResult.filteredContent };
    }

    // Anti-spam content filter (also honours blockLinks automod rule)
    const blockLinks = Boolean(modRules.blockLinks) && !isAdmin;
    let content = body.content;
    if (body.messageType === "text") {
      // filterPublicContent already strips links when isAdmin=false; the
      // blockLinks rule makes this explicit even for edge cases.
      content = filterPublicContent(content, isAdmin);
      if (!content.trim()) {
        throw badRequest("Message content is empty after content filtering");
      }
    }

    // Strip metadata from non-admin senders to prevent link injection via
    // structured fields that bypass the body content filter (PRD §5 anti-spam).
    const safeMetadata = isAdmin ? (body.metadata ?? null) : null;

    // Validate that the reply target belongs to the same room (BUG-MSG01)
    if (body.replyToMessageId) {
      const { rows: replyRows } = await db.query<{ id: string }>(
        `SELECT id FROM room_messages WHERE id = $1 AND room_id = $2 AND is_deleted = FALSE LIMIT 1`,
        [body.replyToMessageId, roomId]
      );
      if (replyRows.length === 0) {
        throw badRequest("Reply target message not found in this room");
      }
    }

    // OFFLINE-IDEMP-GAP: mirrors the DM route's existing-row check so offline-queued
    // room messages retried on reconnect (Expo sync queue / PWA) don't create duplicates.
    if (body.idempotencyKey) {
      const { rows: dupRows } = await db.query<{ id: string }>(
        `SELECT id FROM room_messages WHERE sender_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [userId, body.idempotencyKey]
      );
      if (dupRows[0]) {
        const { rows: existingRows } = await db.query<{
          id: string;
          sender_id: string;
          content: string | null;
          message_type: string;
          metadata: unknown | null;
          created_at: string;
        }>(
          `SELECT id, sender_id, content, message_type, metadata, created_at
           FROM room_messages WHERE id = $1 LIMIT 1`,
          [dupRows[0].id]
        );
        const existing = existingRows[0];
        if (existing) {
          return NextResponse.json(
            { message: toClientMessage(existing, existing.content ?? "") },
            { status: 200 }
          );
        }
      }
    }

    // todayMsgCount is counted AFTER the insert below (inclusive) to prevent off-by-one (BUG-18)

    // Determine if message needs approval (approval-required rooms, non-admin)
    const requiresApproval = Boolean(modRules.requireApproval) && !isAdmin;

    // Persist message and update room counter atomically
    const { rows: msgRows } = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO room_messages
           (room_id, sender_id, content, message_type, metadata, reply_to_message_id,
            is_pending_approval, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          roomId,
          userId,
          content,
          body.messageType,
          safeMetadata ? JSON.stringify(safeMetadata) : null,
          body.replyToMessageId ?? null,
          requiresApproval,
          body.idempotencyKey ?? null,
        ]
      );

      // Increment room's total_messages only for immediately-approved messages.
      // Pending messages (requiresApproval = true) are hidden until a moderator
      // approves them, so we must not count them here (BUG-10 / FIX-E2).
      if (!requiresApproval) {
        await tx.query(
          `UPDATE rooms
           SET total_messages = total_messages + 1, updated_at = NOW()
           WHERE id = $1`,
          [roomId]
        );
      }

      return { rows };
    });

    const message = msgRows[0] as {
      id: string;
      sender_id: string;
      created_at: string;
      message_type: string;
      metadata?: unknown | null;
    };

    // Canonical camelCase payload returned to the sender AND broadcast to other
    // clients, so an optimistic render and the realtime echo are byte-identical.
    const clientMessage = toClientMessage(message, content ?? "");

    // BUG-18: count AFTER insert so the cap is inclusive of the current message
    const todayMsgCount = await countTodayMessages(roomId, userId);

    // Award XP (non-blocking) — publish reward_earned after so the floating
    // notification fires, then trigger any matching daily quest progress.
    maybeAwardMessageXP(message.id, userId, todayMsgCount, senderStatus?.plan ?? 'free')
      .then((xp) => {
        if (xp > 0) {
          return publishRealtimeEvent(`user:${userId}`, "reward_earned", {
            type: "xp",
            amount: xp,
          });
        }
      })
      .catch(() => {});
    void triggerActivityQuestProgress(userId, "send_room_message", db);

    // Publish to realtime provider (non-blocking — never delays the HTTP response)
    if (senderStatus && !requiresApproval) {
      void publishRealtimeEvent(`room:${roomId}:messages`, "new_message", clientMessage);

      // Push notifications for rooms are @mention-only (never the whole room) to
      // avoid spamming large rooms. Resolve mentioned usernames to room members.
      void (async () => {
        const usernames = parseMentions(content);
        if (usernames.length === 0) return;
        const [{ rows: roomRows }, { rows: mentionRows }] = await Promise.all([
          db.query<{ name: string }>(`SELECT name FROM rooms WHERE id = $1`, [roomId]),
          db.query<{ id: string }>(
            `SELECT u.id FROM users u
             JOIN room_members rm
               ON rm.user_id = u.id AND rm.room_id = $1 AND rm.left_at IS NULL
             WHERE LOWER(u.username) = ANY($2) AND u.id <> $3`,
            [roomId, usernames, userId],
          ),
        ]);
        await notifyRoomMentions({
          mentionedUserIds: mentionRows.map((r) => r.id),
          senderName: senderStatus.username || "Someone",
          roomName: roomRows[0]?.name ?? "Room",
          text: content,
          roomId,
        });
      })();
    }

    return NextResponse.json({ message: clientMessage }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
