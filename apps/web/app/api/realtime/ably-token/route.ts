export const runtime = "nodejs";

/**
 * GET /api/realtime/ably-token?channel=dm:conversation:<uuid>
 *
 * Issues a scoped Ably TokenRequest to the authenticated caller.
 * The client passes this endpoint as `authUrl` to the Ably SDK — it is
 * called automatically by the SDK when it needs a token or when the
 * current token expires.
 *
 * Security:
 *   - Verifies the caller's JWT.
 *   - Verifies the caller is a participant in the requested DM conversation.
 *   - Issues a TokenRequest scoped to that one channel with subscribe-only
 *     capability — the client can never publish directly to Ably.
 *   - The Ably API key is never exposed to the client.
 */

import { type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db";

const DM_CHANNEL_RE =
  /^dm:conversation:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ROOM_CHANNEL_RE =
  /^room:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

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

  // 2. Validate channel parameter
  const channel = req.nextUrl.searchParams.get("channel");
  if (!channel) {
    return new Response("Missing channel parameter", { status: 400 });
  }

  const dmMatch = DM_CHANNEL_RE.exec(channel);
  const roomMatch = ROOM_CHANNEL_RE.exec(channel);

  if (!dmMatch && !roomMatch) {
    return new Response("Unsupported channel format", { status: 400 });
  }

  // 3. Verify the caller is authorised to subscribe to this channel
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
      return new Response("Forbidden", { status: 403 });
    }
  } else if (roomMatch) {
    const roomId = roomMatch[1];
    const { rows } = await db.query<{ id: string }>(
      `SELECT r.id FROM rooms r
       WHERE r.id = $1
         AND r.is_active = TRUE
         AND (r.creator_id = $2
              OR EXISTS (
                SELECT 1 FROM room_members m
                WHERE m.room_id = r.id
                  AND m.user_id = $2
                  AND m.left_at IS NULL
              ))
       LIMIT 1`,
      [roomId, userId]
    );
    if (!rows[0]) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  // 4. Issue a scoped Ably TokenRequest
  const apiKey = env.ABLY_API_KEY;
  if (!apiKey) {
    return new Response("Ably not configured", { status: 503 });
  }

  const [keyName] = apiKey.split(":");
  const ttl = 3600 * 1000; // 1 hour in milliseconds
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).slice(2, 18);

  // Build the token request — the Ably SDK or client POSTs this to Ably to get
  // an actual token. Capability is subscribe-only on the specific channel.
  const tokenRequest = {
    keyName,
    ttl,
    capability: JSON.stringify({ [channel]: ["subscribe"] }),
    clientId: userId,
    timestamp,
    nonce,
  };

  // Sign the token request using the full API key
  const { createHmac } = await import("node:crypto");
  const toSign = [
    tokenRequest.keyName,
    tokenRequest.ttl,
    tokenRequest.capability,
    tokenRequest.clientId,
    tokenRequest.timestamp,
    tokenRequest.nonce,
    "",
  ].join("\n");

  const mac = createHmac("sha256", apiKey.split(":")[1] ?? "")
    .update(toSign)
    .digest("base64");

  return Response.json({ ...tokenRequest, mac });
}
