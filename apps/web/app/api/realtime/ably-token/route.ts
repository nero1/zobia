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
import { and, eq, exists, isNull, or } from "drizzle-orm";
import { env } from "@/lib/env";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db/drizzle";

const DM_CHANNEL_RE =
  /^dm:conversation:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ROOM_CHANNEL_RE =
  /^room:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(:[a-z_]+)?$/;
const GROUP_CHANNEL_RE =
  /^group:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(:[a-z_]+)?$/;
// Per-user channel for account-scoped push events (reward_earned, etc.) — see
// lib/quests/questEngine.ts and other publishRealtimeEvent(`user:${userId}`, …) callers.
const USER_CHANNEL_RE =
  /^user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export async function GET(req: NextRequest) {
  // 1. Authenticate — accept the access-token cookie (web) OR a Bearer token
  //    (mobile/Expo, whose SDK calls this via an authCallback using the axios
  //    Authorization header rather than cookies).
  const bearer = req.headers.get("authorization");
  const token =
    req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ??
    (bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : undefined);
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
  const groupMatch = GROUP_CHANNEL_RE.exec(channel);
  const userMatch = USER_CHANNEL_RE.exec(channel);

  if (!dmMatch && !roomMatch && !groupMatch && !userMatch) {
    return new Response("Unsupported channel format", { status: 400 });
  }

  // 3. Verify the caller is authorised to subscribe to this channel
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
      .select({ id: schema.groupChatMembers.id })
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
