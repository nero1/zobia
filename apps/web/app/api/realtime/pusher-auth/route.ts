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
import { and, eq, exists, isNull, or } from "drizzle-orm";
import { env } from "@/lib/env";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db/drizzle";

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

  // 3. Validate channel and authorise the caller
  const dmMatch = DM_CHANNEL_RE.exec(channel_name);
  const roomMatch = !dmMatch ? ROOM_CHANNEL_RE.exec(channel_name) : null;
  const groupMatch = !dmMatch && !roomMatch ? GROUP_CHANNEL_RE.exec(channel_name) : null;
  const userMatch = !dmMatch && !roomMatch && !groupMatch ? USER_CHANNEL_RE.exec(channel_name) : null;

  if (!dmMatch && !roomMatch && !groupMatch && !userMatch) {
    return new Response("Unsupported channel format", { status: 400 });
  }

  const orm = await getDb();
  if (dmMatch) {
    const conversationId = dmMatch[1];
    const [row] = await orm
      .select({ id: schema.dmConversations.id })
      .from(schema.dmConversations)
      .where(
        and(
          eq(schema.dmConversations.id, conversationId),
          or(eq(schema.dmConversations.userId1, userId), eq(schema.dmConversations.userId2, userId))
        )
      )
      .limit(1);
    if (!row) {
      return new Response("Forbidden", { status: 403 });
    }
  } else if (roomMatch) {
    const roomId = roomMatch[1];
    const [row] = await orm
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(
        and(
          eq(schema.rooms.id, roomId),
          eq(schema.rooms.isActive, true),
          or(
            eq(schema.rooms.creatorId, userId),
            exists(
              orm
                .select({ id: schema.roomMembers.id })
                .from(schema.roomMembers)
                .where(
                  and(
                    eq(schema.roomMembers.roomId, schema.rooms.id),
                    eq(schema.roomMembers.userId, userId),
                    isNull(schema.roomMembers.leftAt)
                  )
                )
            )
          )
        )
      )
      .limit(1);
    if (!row) {
      return new Response("Forbidden", { status: 403 });
    }
  } else if (groupMatch) {
    const groupId = groupMatch[1];
    const [row] = await orm
      .select({ group_chat_id: schema.groupChatMembers.groupChatId })
      .from(schema.groupChatMembers)
      .where(and(eq(schema.groupChatMembers.groupChatId, groupId), eq(schema.groupChatMembers.userId, userId)))
      .limit(1);
    if (!row) {
      return new Response("Forbidden", { status: 403 });
    }
  } else if (userMatch) {
    // A user's personal channel may only ever be subscribed to by that user.
    if (userMatch[1] !== userId) {
      return new Response("Forbidden", { status: 403 });
    }
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
