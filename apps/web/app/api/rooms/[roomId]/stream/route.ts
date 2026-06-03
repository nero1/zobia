/**
 * app/api/rooms/[roomId]/stream/route.ts
 *
 * SSE endpoint for room message streaming.
 *
 * GET /api/rooms/:roomId/stream
 *   Returns new messages as they are polled from the database every 2 seconds.
 *   Format: data: {type: "message", payload: {...}}\n\n
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
 *   The stream closes automatically after 60 seconds; clients should reconnect.
 *   Requires a valid JWT (Authorization header or access_token cookie).
 *
 * Usage:
 *   const es = new EventSource(`/api/rooms/${roomId}/stream?lastMessageId=${lastId}`);
 *   es.onmessage = (e) => {
 *     const { type, payload } = JSON.parse(e.data);
 *     if (type === 'message') appendMessage(payload);
 *     if (type === 'ping')    console.log('alive');
 *   };
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  verifyAccessToken,
  extractBearerToken,
} from "@/lib/auth/jwt";
import { getSession, ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often the server polls the database for new messages (ms). */
const POLL_INTERVAL_MS = 2_000;

/** Maximum lifetime of an SSE connection before client must reconnect (ms). */
const MAX_STREAM_DURATION_MS = 60_000;

/** Keep-alive ping interval (ms). */
const PING_INTERVAL_MS = 15_000;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Fetch messages created after the given cursor timestamp or lastMessageId.
 */
async function fetchNewMessages(
  roomId: string,
  afterCreatedAt: string | null
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
         AND m.created_at > $2
       ORDER BY m.created_at ASC
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
       ORDER BY m.created_at DESC
       LIMIT 20`;

  const { rows } = await db.query<MessageRow>(
    query,
    afterCreatedAt ? [roomId, afterCreatedAt] : [roomId]
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

  const { roomId } = await params;

  // ---- Room access check ---------------------------------------------------
  const { rows: roomRows } = await db.query<{
    type: string;
    creator_id: string;
    is_active: boolean;
  }>(
    `SELECT type, creator_id, is_active FROM rooms WHERE id = $1`,
    [roomId]
  );
  const room = roomRows[0];
  if (!room || !room.is_active) {
    return new Response("Room not found", { status: 404 });
  }

  const isCreator = room.creator_id === userId;

  // Check membership
  const { rows: memberRows } = await db.query<{ role: string }>(
    `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId]
  );
  const isMember = memberRows.length > 0;

  if (!isMember && !isCreator && room.type !== "vip") {
    return new Response("Forbidden", { status: 403 });
  }

  // ---- Resolve lastMessageId to a created_at cursor ------------------------
  const url = new URL(req.url);
  const lastMessageId = url.searchParams.get("lastMessageId");

  let afterCreatedAt: string | null = null;
  if (lastMessageId) {
    const { rows: anchorRows } = await db.query<{ created_at: string }>(
      `SELECT created_at FROM room_messages WHERE id = $1 AND room_id = $2`,
      [lastMessageId, roomId]
    );
    afterCreatedAt = anchorRows[0]?.created_at ?? null;
  }

  // ---- Build SSE stream ----------------------------------------------------
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

      // Send initial batch of messages
      try {
        const initial = await fetchNewMessages(roomId, afterCreatedAt);
        for (const msg of initial) {
          enqueue({ type: "message", payload: msg });
          afterCreatedAt = msg.created_at;
        }
      } catch (err) {
        console.error("[stream] initial fetch error:", err);
      }

      // Periodic poll for new messages
      const pollId = setInterval(async () => {
        if (closed) {
          clearInterval(pollId);
          return;
        }
        try {
          const newMessages = await fetchNewMessages(roomId, afterCreatedAt);
          for (const msg of newMessages) {
            enqueue({ type: "message", payload: msg });
            afterCreatedAt = msg.created_at;
          }
        } catch (err) {
          console.error("[stream] poll error:", err);
        }
      }, POLL_INTERVAL_MS);

      // Keep-alive ping to prevent proxy/browser timeouts
      const pingId = setInterval(() => {
        enqueue({ type: "ping", ts: Date.now() });
      }, PING_INTERVAL_MS);

      // Auto-close after MAX_STREAM_DURATION_MS (client should reconnect)
      const timeoutId = setTimeout(() => {
        clearInterval(pollId);
        clearInterval(pingId);
        closed = true;
        enqueue({ type: "close", reason: "reconnect" });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }, MAX_STREAM_DURATION_MS);

      // Cleanup on client disconnect
      req.signal.addEventListener("abort", () => {
        clearInterval(pollId);
        clearInterval(pingId);
        clearTimeout(timeoutId);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
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
