import { authorizeRealtimeChannel as authorizeChannel } from "@/lib/realtime/channelAccess";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/security/rateLimit";
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
import { env } from "@/lib/env";
import { authenticateAccessToken } from "@/lib/auth/principal";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { getDb } from "@/lib/db/drizzle";

const MAX_CHANNELS = 20;

export async function GET(req: NextRequest) {
  // 1. Authenticate — accept the access-token cookie (web) OR a Bearer token
  //    (mobile/Expo, whose SDK calls this via an authCallback using the axios
  //    Authorization header rather than cookies).
  const bearer = req.headers.get("authorization");
  const token =
    (bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : req.cookies.get(ACCESS_TOKEN_COOKIE)?.value);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let userId: string;
  let expiresAt = 0;
  try {
    const { payload } = await authenticateAccessToken(token);
    userId = payload.sub;
    expiresAt = (payload.exp ?? 0) * 1000;
  } catch(error) {
    return handleApiError(error);
  }

  try { await enforceRateLimit(userId,"user",{name:"realtime:sign",limit:60,windowMs:60000,globalLimit:20000}); }
  catch(error){return handleApiError(error);}

  // 2. Parse the requested channels
  const params = req.nextUrl.searchParams;
  if ((params.get("channels")??params.get("channel")??"").length>2000) return new Response("Channel list too large",{status:400});
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
  const ttl = Math.min(300_000,expiresAt-Date.now());
  if (ttl <= 0) return new Response("Unauthorized", {status:401});
  const timestamp = Date.now();
  const { randomBytes } = await import("node:crypto");
  const nonce = randomBytes(16).toString("hex");

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
