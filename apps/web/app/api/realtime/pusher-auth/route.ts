import {readBoundedBytes} from "@/lib/security/requestBody";
import { authorizeRealtimeChannel } from "@/lib/realtime/channelAccess";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/security/rateLimit";
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
import { authenticateAccessToken } from "@/lib/auth/principal";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/db/drizzle";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DM_CHANNEL_RE = new RegExp(`^private-dm-conversation-(${UUID})$`);
// "room:<uuid>:messages" maps to "private-room-<uuid>-messages" (see
// lib/realtime/pusherChannelName.ts) — the "-messages" suffix is the only
// room channel currently published to, but the suffix is optional here for
// forward compatibility with a bare room presence/event channel.
const ROOM_CHANNEL_RE = new RegExp(`^private-room-(${UUID})(?:-messages)?$`);
const GROUP_CHANNEL_RE = new RegExp(`^private-group-(${UUID})-messages$`);
// "user:<uuid>" → "private-user-<uuid>" — the per-user channel used for
// account-scoped push events (reward_earned, etc.). Only the owning user may
// ever subscribe to their own channel.
const USER_CHANNEL_RE = new RegExp(`^private-user-(${UUID})$`);

export async function POST(req: NextRequest) {
  // 1. Authenticate
  const bearer = req.headers.get("authorization");
  const token = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let userId: string;
  try {
    const { payload } = await authenticateAccessToken(token);
    userId = payload.sub;
  } catch(error) {
    return handleApiError(error);
  }

  try { await enforceRateLimit(userId,"user",{name:"realtime:sign",limit:60,windowMs:60000,globalLimit:20000}); }
  catch(error){return handleApiError(error);}

  // 2. Parse body
  let body: { socket_id?: string; channel_name?: string };
  try {
    const text = new TextDecoder("utf-8",{fatal:true}).decode(await readBoundedBytes(req,16384));
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

  if (!body || typeof body!=="object" || Array.isArray(body)) return new Response("Invalid request body",{status:400});
  const { socket_id, channel_name } = body;
  if (typeof socket_id !== "string" || socket_id.length>64 || !/^\d+\.\d+$/.test(socket_id) || typeof channel_name !== "string" || channel_name.length>200) return new Response("Invalid channel request",{status:400});
  if (!socket_id || !channel_name) {
    return new Response("Missing socket_id or channel_name", { status: 400 });
  }

  // 3. Validate channel and authorise the caller
  const dmMatch = DM_CHANNEL_RE.exec(channel_name);
  const roomMatch = !dmMatch ? ROOM_CHANNEL_RE.exec(channel_name) : null;
  const groupMatch = !dmMatch && !roomMatch ? GROUP_CHANNEL_RE.exec(channel_name) : null;
  const userMatch = !dmMatch && !roomMatch && !groupMatch ? USER_CHANNEL_RE.exec(channel_name) : null;

  if (!dmMatch && !roomMatch && !groupMatch && !userMatch) {
    return new Response("Unsupported channel format", { status: 400 });
  }

  const logicalChannel = dmMatch ? `dm:conversation:${dmMatch[1]}` : roomMatch ? `room:${roomMatch[1]}:messages` : groupMatch ? `group:${groupMatch[1]}:messages` : `user:${userMatch![1]}`;
  const orm = await getDb();
  if (await authorizeRealtimeChannel(orm,userId,logicalChannel)!=="ok") return new Response("Forbidden",{status:403});

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
