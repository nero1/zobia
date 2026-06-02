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
import { db } from "@/lib/db";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { filterPublicContent } from "@/lib/messaging/antispam";
import { XP_VALUES, ROOM_MESSAGE_XP_DAILY_CAP } from "@/lib/xp/engine";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
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
  messageType: z
    .enum(["text", "sticker", "gif", "gift", "system"])
    .default("text"),
  metadata: z.record(z.unknown()).optional(),
  replyToMessageId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

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
}

interface MemberRow {
  role: string;
  is_muted: boolean;
  muted_until: string | null;
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
    `SELECT role, is_muted, muted_until
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
       AND created_at >= CURRENT_DATE`,
    [roomId, userId]
  );
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

/**
 * Award 2 XP to the sender if they have not yet hit the daily 50-message cap.
 * Silently swallows errors.
 *
 * @param roomId          - Room UUID
 * @param userId          - Sender UUID
 * @param todayMsgCount   - How many messages they have already sent today
 */
async function maybeAwardMessageXP(
  roomId: string,
  userId: string,
  todayMsgCount: number
): Promise<void> {
  if (todayMsgCount >= ROOM_MESSAGE_XP_DAILY_CAP) return;
  try {
    const xp = XP_VALUES.send_message_in_room; // 2 XP
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users
         SET xp_total = xp_total + $1,
             xp_social = xp_social + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [xp, userId]
      );
      await tx.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, reference_id, multiplier, base_amount)
         VALUES ($1, $2, 'social', 'message', $3, 100, $2)`,
        [userId, xp, roomId]
      );
    });
  } catch (err) {
    console.error("[rooms/messages] XP award failed (non-fatal):", err);
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
    }>(
      `SELECT type, creator_id, is_active FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

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
    ];
    const queryArgs: unknown[] = [roomId];
    let paramIdx = 2;

    if (queryParams.cursor) {
      conditions.push(`m.created_at < $${paramIdx++}`);
      queryArgs.push(queryParams.cursor);
    }

    queryArgs.push(limit);
    const limitParam = paramIdx;

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
         m.created_at
       FROM room_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.created_at DESC
       LIMIT $${limitParam}`,
      queryArgs
    );

    const nextCursor =
      messages.length === limit
        ? (messages[messages.length - 1]?.created_at ?? null)
        : null;

    return NextResponse.json(
      { items: messages, nextCursor, hasMore: nextCursor !== null },
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
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;
    const body = await validateBody(req, sendMessageSchema);

    // Fetch room
    const { rows: roomRows } = await db.query<{
      type: string;
      creator_id: string;
      is_active: boolean;
    }>(
      `SELECT type, creator_id, is_active FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

    const isCreator = room.creator_id === userId;

    // Verify membership
    const membership = await getCallerMembership(roomId, userId);
    if (!membership && !isCreator) {
      throw forbidden("You must be a member to send messages in this room");
    }

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

    // Anti-spam content filter
    const isAdmin =
      isCreator ||
      membership?.role === "admin" ||
      membership?.role === "co_moderator";

    let content = body.content;
    if (body.messageType === "text") {
      content = filterPublicContent(content, isAdmin);
      if (!content.trim()) {
        throw badRequest("Message content is empty after content filtering");
      }
    }

    // Count today's messages for XP cap check (before insert)
    const todayMsgCount = await countTodayMessages(roomId, userId);

    // Persist message and update room counter atomically
    const { rows: msgRows } = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO room_messages
           (room_id, sender_id, content, message_type, metadata, reply_to_message_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          roomId,
          userId,
          content,
          body.messageType,
          body.metadata ? JSON.stringify(body.metadata) : null,
          body.replyToMessageId ?? null,
        ]
      );

      // Increment room's total_messages
      await tx.query(
        `UPDATE rooms
         SET total_messages = total_messages + 1, updated_at = NOW()
         WHERE id = $1`,
        [roomId]
      );

      return rows;
    });

    const message = msgRows[0];

    // Award XP (non-blocking)
    void maybeAwardMessageXP(roomId, userId, todayMsgCount);

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
