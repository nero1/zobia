export const runtime = "nodejs";

/**
 * GET /api/realtime/ably-token?channels=<c1>,<c2>,...   (or ?channel=<c>)
 *
 * Issues a scoped Ably TokenRequest to the authenticated caller. Web and the
 * Capacitor app keep ONE shared Ably connection per signed-in session and
 * call this (from their authCallback) only when they join a channel the
 * current token does not cover, or when it expires, instead of once per
 * channel mount. Every call is billed Vercel Active CPU, so one token covers
 * all channels in use (up to MAX_CHANNELS).
 *
 * Security:
 *   - Verifies the caller's JWT.
 *   - Authorizes every requested channel individually (DM participant, room
 *     member/creator, group member, own user channel).
 *   - Channels that fail authorization are left out of the capability; the
 *     client reads the granted list back from `capability`. If none pass,
 *     403.
 *   - Capability is subscribe-only: the client can never publish to Ably.
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

const MAX_CHANNELS = 20;

type Orm = Awaited<ReturnType<typeof getDb>>;

/** "ok" if `userId` may subscribe to `channel`, "forbidden" if not, "unsupported" for unknown formats. */
async function authorizeChannel(orm: Orm, userId: string, channel: string): Promise<"ok" | "forbidden" | "unsupported"> {
  const dmMatch = DM_CHANNEL_RE.exec(channel);
  const roomMatch = ROOM_CHANNEL_RE.exec(channel);
  const groupMatch = GROUP_CHANNEL_RE.exec(channel);
  const userMatch = USER_CHANNEL_RE.exec(channel);

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
    return row ? "ok" : "forbidden";
  }
  if (roomMatch) {
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
    return row ? "ok" : "forbidden";
  }
  if (groupMatch) {
    const groupId = groupMatch[1];
    const [row] = await orm
      .select({ id: schema.groupChatMembers.id })
      .from(schema.groupChatMembers)
      .where(and(eq(schema.groupChatMembers.groupChatId, groupId), eq(schema.groupChatMembers.userId, userId)))
      .limit(1);
    return row ? "ok" : "forbidden";
  }
  if (userMatch) {
    // A user's personal channel may only ever be subscribed to by that user.
    return userMatch[1] === userId ? "ok" : "forbidden";
  }
  return "unsupported";
}

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

  // 2. Parse the requested channels
  const params = req.nextUrl.searchParams;
  const requested = Array.from(
    new Set(
      (params.get("channels") ?? params.get("channel") ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    )
  );
  if (requested.length === 0) {
    return new Response("Missing channel parameter", { status: 400 });
  }
  if (requested.length > MAX_CHANNELS) {
    return new Response(`At most ${MAX_CHANNELS} channels per token`, { status: 400 });
  }

  // 3. Authorize each channel; keep only the ones the caller may subscribe to
  const orm = await getDb();
  const results = await Promise.all(requested.map((c) => authorizeChannel(orm, userId, c)));
  if (results.every((r) => r === "unsupported")) {
    return new Response("Unsupported channel format", { status: 400 });
  }
  const granted = requested.filter((_, i) => results[i] === "ok");
  if (granted.length === 0) {
    return new Response("Forbidden", { status: 403 });
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
  // an actual token. Capability is subscribe-only on the granted channels.
  const tokenRequest = {
    keyName,
    ttl,
    capability: JSON.stringify(Object.fromEntries(granted.map((c) => [c, ["subscribe"]]))),
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
