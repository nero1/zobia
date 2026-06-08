export const runtime = "nodejs";

/**
 * POST /api/realtime/pusher-auth
 *
 * Standard Pusher private-channel auth endpoint.
 * Body: { socket_id: string; channel_name: string }
 *
 * Security:
 *   - Verifies the caller's JWT.
 *   - Parses the conversation UUID from channel_name.
 *   - Verifies the caller is a participant in that conversation.
 *   - Returns the HMAC-SHA256 auth string — PUSHER_SECRET never leaves the server.
 */

import { type NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Pusher private channel format: private-dm-conversation-{uuid}
const CHANNEL_RE =
  /^private-dm-conversation-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export async function POST(req: NextRequest) {
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

  // 2. Parse body
  let body: { socket_id?: string; channel_name?: string };
  try {
    const text = await req.text();
    // Pusher sends URL-encoded body: socket_id=...&channel_name=...
    const params = new URLSearchParams(text);
    body = {
      socket_id: params.get("socket_id") ?? undefined,
      channel_name: params.get("channel_name") ?? undefined,
    };
    // Fall back to JSON if not URL-encoded
    if (!body.socket_id) {
      const parsed = JSON.parse(text) as typeof body;
      body = parsed;
    }
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const { socket_id, channel_name } = body;
  if (!socket_id || !channel_name) {
    return new Response("Missing socket_id or channel_name", { status: 400 });
  }

  // 3. Validate channel and extract conversation ID
  const match = CHANNEL_RE.exec(channel_name);
  if (!match) {
    return new Response("Unsupported channel format", { status: 400 });
  }

  const conversationId = match[1];
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM dm_conversations
     WHERE id = $1
       AND (user_id_1 = $2 OR user_id_2 = $2)
     LIMIT 1`,
    [conversationId, userId]
  );
  if (!rows[0]) {
    return new Response("Forbidden", { status: 403 });
  }

  // 4. Generate Pusher auth signature
  const { PUSHER_KEY, PUSHER_SECRET } = env;
  if (!PUSHER_KEY || !PUSHER_SECRET) {
    return new Response("Pusher not configured", { status: 503 });
  }

  const toSign = `${socket_id}:${channel_name}`;
  const signature = createHmac("sha256", PUSHER_SECRET)
    .update(toSign)
    .digest("hex");

  return Response.json({ auth: `${PUSHER_KEY}:${signature}` });
}
