import { BRIDGE_COOKIE, bridgeCookie, readBridgeGrant, createBridgeIntent, consumeBridgeIntent, type BridgeGrant } from "@/lib/auth/mobileBridge";
import { readBoundedBytes } from "@/lib/security/requestBody";
export const dynamic = 'force-dynamic';

/** GET establishes a browser-bound confirmation intent; only a same-origin,
 * one-time POST can create the delegated cookie session. Both phases recheck
 * the originating session and live account standing. */

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createSession, buildCookieHeaders, getSessionFresh } from "@/lib/auth/session";
import { enforceRateLimit, getClientIp, getUserAgent, RATE_LIMITS } from "@/lib/security/rateLimit";
import { handleApiError,forbidden,badRequest } from "@/lib/api/errors";

async function loadPrincipal(grant: BridgeGrant) {
    const source = await getSessionFresh(grant.sourceSid);
    if (!source || source.uid !== grant.userId || source.parentSid) return null;
    const userId = grant.userId;
    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.users.id,
        email: schema.users.email,
        username: schema.users.username,
        is_admin: schema.users.isAdmin,
        is_moderator: schema.users.isModerator,
        is_creator: schema.users.isCreator,
        onboarding_completed: schema.users.onboardingCompleted,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt),sql`${schema.users.sessionValidAfter}<=${source.created_at}::timestamptz`,eq(schema.users.isBanned,false),sql`NOT(COALESCE(${schema.users.isSuspended},false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`))
      .limit(1);
    const user = rows[0];
    if (!user) {
      return null;
    }

    return { user, source };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.oauthCallback);
    const origin = new URL(req.url).origin;
    const code = req.nextUrl.searchParams.get("code") ?? "";
    const grant = await readBridgeGrant(code);
    if (grant && req.nextUrl.searchParams.has("redirect") && req.nextUrl.searchParams.get("redirect") !== grant.path) throw badRequest("Hand-off destination does not match");
    if (!grant) {
      return NextResponse.redirect(new URL("/auth/mobile-bridge", origin), {status:303});
    }
    const principal = await loadPrincipal(grant);
    if (!principal) return NextResponse.redirect(new URL("/auth/mobile-bridge",origin),{status:303});
    const intent = await createBridgeIntent(code, grant, principal.user.username, !!principal.source.impersonatedBy);
    const response = NextResponse.redirect(new URL(`/auth/mobile-bridge?intent=${intent.id}`, origin), {status:303});
    response.headers.append("Set-Cookie", bridgeCookie(intent.secret));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return handleApiError(error); }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const origin = new URL(req.url).origin;
    if (req.headers.get("origin") !== origin) throw forbidden("Browser confirmation must originate from this website");
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.oauthCallback);
    const body = new URLSearchParams(new TextDecoder("utf-8", {fatal:true}).decode(await readBoundedBytes(req,4096)));
    const grant = await consumeBridgeIntent(body.get("intent") ?? "", req.cookies.get(BRIDGE_COOKIE)?.value);
    if (!grant) return NextResponse.redirect(new URL("/auth/mobile-bridge",origin), {status:303});
    const principal = await loadPrincipal(grant);
    if (!principal) return NextResponse.redirect(new URL("/auth/mobile-bridge",origin), {status:303});
    const {user,source} = principal;
    const authTokens = await createSession(
      {...user, onboarding_completed:user.onboarding_completed ?? false},
      {ip:getClientIp(req),ua:getUserAgent(req),parentSid:source.sid,impersonatedBy:source.impersonatedBy,adminSession:source.adminSession}
    );
    const {accessCookie,refreshCookie} = buildCookieHeaders(authTokens,undefined,authTokens.refreshTtl);
    const response = NextResponse.redirect(new URL(grant.path,origin),{status:303});
    for (const cookie of [accessCookie,refreshCookie,bridgeCookie("",true)]) response.headers.append("Set-Cookie",cookie);
    response.headers.set("Cache-Control","no-store");
    response.headers.set("Referrer-Policy","no-referrer");
    return response;
  } catch (error) { return handleApiError(error); }
}
