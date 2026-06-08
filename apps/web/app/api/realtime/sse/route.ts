export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/realtime/sse?channel=<channel>
 *
 * Server-Sent Events bridge backed by Redis Pub/Sub.
 *
 * Flow:
 *   1. Client opens an EventSource connection with a channel query param.
 *   2. This route verifies the caller's JWT and their right to subscribe.
 *   3. A dedicated IORedis subscriber connection is opened for this SSE stream.
 *   4. Whenever the server publishes to that Redis channel (via publishRealtimeEvent),
 *      the event is forwarded to the client as an SSE "data:" line.
 *   5. On disconnect the Redis connection is cleanly closed.
 *
 * Supported channels:
 *   dm:conversation:<uuid>  — DM conversation; caller must be a participant.
 *
 * Keep-alive:
 *   A comment ping is sent every 25 seconds to keep the connection alive
 *   through proxies and load balancers.
 *
 * Fallback:
 *   If the client's browser does not support EventSource, or if Redis is
 *   unavailable, the client falls back to 5-second polling (handled client-side).
 */

import { type NextRequest } from "next/server";
import IORedis from "ioredis";
import { env } from "@/lib/env";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Channel allow-list
// ---------------------------------------------------------------------------

const DM_CHANNEL_RE = /^dm:conversation:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// ---------------------------------------------------------------------------
// Auth + channel access check
// ---------------------------------------------------------------------------

async function authorizeChannel(
  channel: string,
  userId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const dmMatch = DM_CHANNEL_RE.exec(channel);
  if (dmMatch) {
    const conversationId = dmMatch[1];
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM dm_conversations
       WHERE id = $1
         AND (user_id_1 = $2 OR user_id_2 = $2)
       LIMIT 1`,
      [conversationId, userId]
    );
    if (!rows[0]) {
      return { allowed: false, reason: "Not a participant in this conversation" };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: "Unknown or unsupported channel" };
}

// ---------------------------------------------------------------------------
// SSE route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // 1. Authenticate
  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let userId: string;
  try {
    const payload = await verifyAccessToken(token);
    userId = payload.sub;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Validate channel
  const channel = req.nextUrl.searchParams.get("channel");
  if (!channel) {
    return new Response("Missing channel parameter", { status: 400 });
  }

  const { allowed, reason } = await authorizeChannel(channel, userId);
  if (!allowed) {
    return new Response(reason ?? "Forbidden", { status: 403 });
  }

  // 3. Create a dedicated Redis subscriber (pub/sub mode locks the connection)
  const sub = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 0,
    lazyConnect: false,
    connectTimeout: 8_000,
    retryStrategy: () => null, // no retries for subscriber connections
  });

  let closed = false;

  // 4. Build the SSE ReadableStream
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      function send(text: string) {
        if (!closed) {
          try {
            controller.enqueue(enc.encode(text));
          } catch {
            // Stream already closed
          }
        }
      }

      // Keep-alive ping every 25 seconds
      const pingInterval = setInterval(() => send(": ping\n\n"), 25_000);

      // Subscribe to Redis channel
      await sub.subscribe(channel).catch((err) => {
        console.error("[sse] Redis subscribe failed", err);
        closed = true;
        clearInterval(pingInterval);
        sub.disconnect();
        controller.close();
      });

      sub.on("message", (_ch: string, message: string) => {
        send(`data: ${message}\n\n`);
      });

      sub.on("error", (err) => {
        console.error("[sse] Redis subscriber error", err);
        clearInterval(pingInterval);
        if (!closed) {
          closed = true;
          sub.disconnect();
          controller.close();
        }
      });

      // Clean up when the client disconnects
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(pingInterval);
        sub.unsubscribe(channel).catch(() => {});
        sub.disconnect();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      // Prevent Nginx / Vercel from buffering the stream
      "X-Accel-Buffering": "no",
    },
  });
}
