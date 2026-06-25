export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/stream/route.ts
 *
 * SSE endpoint for room message streaming — push-on-write architecture.
 *
 * GET /api/rooms/:roomId/stream
 *   Sends the initial batch of messages then a `realtime_ready` event that
 *   instructs the client to subscribe to the realtime provider directly.
 *   The stream closes immediately after delivering those events — no
 *   long-lived polling loop. This is safe on Vercel Hobby serverless because
 *   function execution time is bounded and the DB pool is not exhausted.
 *
 *   Format: data: {type: "message"|"realtime_ready"}\n\n
 *
 *   Query params:
 *     - lastMessageId  UUID of the last message the client has seen.
 *                      Only messages created after this message are sent.
 *                      Omit to receive the 20 most recent messages on connect,
 *                      then only new ones thereafter.
 *
 *   Headers set on response:
 *     Content-Type:  text/event-stream
 *     Cache-Control: no-cache
 *     Connection:    keep-alive
 *
 *   After receiving `realtime_ready`, clients must subscribe to the realtime
 *   provider channel `room:<roomId>:messages` using the native SDK to receive
 *   new messages in real time.
 *
 * Usage:
 *   const es = new EventSource(`/api/rooms/${roomId}/stream?lastMessageId=${lastId}`);
 *   es.onmessage = (e) => {
 *     const { type, payload, channel } = JSON.parse(e.data);
 *     if (type === 'message')        appendMessage(payload);
 *     if (type === 'realtime_ready') subscribeToChannel(channel);
 *   };
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  verifyAccessToken,
  extractBearerToken,
} from "@/lib/auth/jwt";
import { getSession, ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
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
  created_at: string;
}

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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  };
}

/**
 * Extract the JWT access token from the request.
 * Checks Authorization header first, then falls back to the HttpOnly cookie.
 */
function extractToken(req: NextRequest): string | null {
  const bearerToken = extractBearerToken(req.headers.get("authorization"));
  if (bearerToken) return bearerToken;
  return req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

/**
 * Encode a single SSE event frame.
 */
function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Fetch messages using a composite (created_at, id) cursor to avoid skipping
 * messages that share the same timestamp as the last seen message.
 */
async function fetchNewMessages(
  roomId: string,
  afterCreatedAt: string | null,
  afterId: string | null
): Promise<MessageRow[]> {
  const query = afterCreatedAt
    ? `SELECT
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
         m.created_at
       FROM room_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = $1
         AND m.is_deleted = FALSE
         AND (m.created_at, m.id) > ($2, $3)
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT 50`
    : `SELECT
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
         m.created_at
       FROM room_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.room_id = $1
         AND m.is_deleted = FALSE
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 20`;

  const { rows } = await db.query<MessageRow>(
    query,
    afterCreatedAt ? [roomId, afterCreatedAt, afterId ?? ""] : [roomId]
  );

  // For the initial load (no cursor), reverse to chronological order
  return afterCreatedAt ? rows : rows.reverse();
}

// ---------------------------------------------------------------------------
// GET /api/rooms/[roomId]/stream
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  // ---- Auth ----------------------------------------------------------------
  const token = extractToken(req);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let userId: string;
  try {
    const payload = await verifyAccessToken(token);
    const session = await getSession(payload.sid);
    if (!session) {
      return new Response("Session revoked", { status: 401 });
    }
    userId = payload.sub;
  } catch {
    return new Response("Invalid token", { status: 401 });
  }

  // Rate-limit SSE connections per user
  try {
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);
  } catch {
    return new Response("Too Many Requests", { status: 429 });
  }

  const { roomId } = await params;

  // ---- Room access check ---------------------------------------------------
  // BUG-SSE-01: also filter out soft-deleted rooms
  const { rows: roomRows } = await db.query<{
    type: string;
    creator_id: string;
    is_active: boolean;
  }>(
    `SELECT type, creator_id, is_active FROM rooms WHERE id = $1 AND deleted_at IS NULL`,
    [roomId]
  );
  const room = roomRows[0];
  if (!room || !room.is_active) {
    return new Response("Room not found", { status: 404 });
  }

  const isCreator = room.creator_id === userId;

  // Check membership; BUG-SSE-03: also fetch muted_until to block muted members
  const { rows: memberRows } = await db.query<{ role: string; muted_until: string | null }>(
    `SELECT role, muted_until FROM room_members WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId]
  );
  const isMember = memberRows.length > 0;
  const mutedUntil = memberRows[0]?.muted_until ?? null;
  if (isMember && mutedUntil && new Date(mutedUntil) > new Date()) {
    return new Response("You are muted in this room", { status: 403 });
  }

  if (!isMember && !isCreator) {
    // VIP rooms: non-subscribers receive a 403 — paywall must be enforced here
    // just as in the REST messages endpoint. The SSE stream has no preview mode.
    if (room.type === "vip") {
      return new Response("Subscription required", { status: 403 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ---- Resolve lastMessageId to a composite cursor -------------------------
  const url = new URL(req.url);
  const rawLastMessageId = url.searchParams.get("lastMessageId");
  // BUG-SSE-02: validate UUID format before using in a query to prevent injection
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lastMessageId = rawLastMessageId && UUID_RE.test(rawLastMessageId) ? rawLastMessageId : null;

  let afterCreatedAt: string | null = null;
  let afterId: string | null = null;
  if (lastMessageId) {
    const { rows: anchorRows } = await db.query<{ created_at: string; id: string }>(
      `SELECT created_at, id FROM room_messages WHERE id = $1 AND room_id = $2`,
      [lastMessageId, roomId]
    );
    if (anchorRows[0]) {
      afterCreatedAt = anchorRows[0].created_at;
      afterId = anchorRows[0].id;
    }
  }

  // ---- Build SSE stream ----------------------------------------------------
  // Architecture: send the initial batch of messages, then a realtime_ready
  // event so the client can subscribe to the provider's native SDK channel.
  // The stream closes immediately — no polling loop, no function-hours wasted.
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: unknown) => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(sseEvent(data)));
          } catch {
            closed = true;
          }
        }
      };

      // Cleanup on client disconnect (fires if the client closes before we do)
      req.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      // Send initial batch of messages
      try {
        const initial = await fetchNewMessages(roomId, afterCreatedAt, afterId);
        for (const msg of initial) {
          enqueue({ type: "message", payload: rowToMessage(msg) });
        }
      } catch (err) {
        logger.error({ err: err }, "[stream] initial fetch error:");
      }

      // Instruct the client to subscribe via the realtime provider's native SDK.
      // The client should connect to this channel to receive new messages going
      // forward. See lib/realtime/index.ts for the architecture note.
      enqueue({
        type: "realtime_ready",
        channel: `room:${roomId}:messages`,
      });

      // Close the stream — the client now uses the realtime SDK for new messages.
      closed = true;
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering for SSE
    },
  });
}
