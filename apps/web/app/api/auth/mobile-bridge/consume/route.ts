export const dynamic = 'force-dynamic';

/**
 * app/api/auth/mobile-bridge/consume/route.ts
 *
 * GET /api/auth/mobile-bridge/consume?code=<code>&redirect=<path>
 *
 * Companion to ../route.ts (see its header comment for the full ZSB-04
 * context). Not authenticated by Bearer token — the single-use `code` itself
 * is the credential, exactly like the OAuth `mobile_exchange` code flow.
 *
 * Looks up the code (atomically deleting it — single use), resolves the
 * owning user, mints a brand-new web session, sets the same HttpOnly
 * `accessCookie`/`refreshCookie` the OAuth web flow sets, and redirects to
 * the originally-requested path so the destination page renders normally.
 */

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createSession, buildCookieHeaders, getSessionFresh } from "@/lib/auth/session";
import { enforceRateLimit, getClientIp, getUserAgent, RATE_LIMITS } from "@/lib/security/rateLimit";
import { handleApiError,badRequest } from "@/lib/api/errors";

// Path plus an optional bounded query string (alphanumeric keys/values,
// `=`/`&` separators only — no fragments). Deliberately looser than the
// OAuth web-redirect SAFE_REDIRECT_RE in app/api/auth/google/callback/
// route.ts, which disallows query strings entirely because that redirect
// target is public-facing (BUG-030). This endpoint's redirect targets are
// restricted server-side to `ALLOWED_BRIDGE_PATHS` in ../route.ts — the only
// one that currently carries a query string is `/gate44/kyc?userId=<uuid>`,
// so allowing a bounded alphanumeric query string here is required for that
// flow to actually land on the right admin page instead of silently falling
// back to /home, while still rejecting anything that could carry `<`, `"`,
// `javascript:`, `//`, or other injection-relevant characters.
const SAFE_REDIRECT_RE = /^\/[a-zA-Z0-9/_-]*(?:\?[a-zA-Z0-9=&_-]*)?$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    const ua = getUserAgent(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.oauthCallback);

    const reqOrigin = new URL(req.url).origin;
    const code = req.nextUrl.searchParams.get("code");
    const redirectParam = req.nextUrl.searchParams.get("redirect");
    if (!code || !/^[a-f0-9]{64}$/.test(code)) {
      return NextResponse.redirect(new URL("/auth/login", reqOrigin), { status: 302 });
    }

    // Atomic single-use consume — a replayed/guessed code fails from here on.
    const raw = await redis.getdel(`mobile_bridge:${code}`);
    if (!raw) {
      return NextResponse.redirect(new URL("/auth/login", reqOrigin), { status: 302 });
    }

    const grant = JSON.parse(raw) as {userId:string;sourceSid:string;path:string};
    const source = await getSessionFresh(grant.sourceSid);
    if (!source || source.uid !== grant.userId) return NextResponse.redirect(new URL("/auth/login",reqOrigin),{status:302});
    const userId = grant.userId;
    if (!grant.path.startsWith("/") || grant.path.startsWith("//") || !SAFE_REDIRECT_RE.test(grant.path)) throw badRequest("Invalid hand-off destination");
    if (redirectParam && redirectParam !== grant.path) throw badRequest("Hand-off destination does not match");
    const destination = new URL(grant.path, reqOrigin);
    if(destination.origin!==reqOrigin)throw badRequest("Invalid hand-off destination");
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
      return NextResponse.redirect(new URL("/auth/login", reqOrigin), { status: 302 });
    }

    const authTokens = await createSession(
      { ...user, onboarding_completed: user.onboarding_completed ?? false },
      { ip, ua, parentSid:source.sid, impersonatedBy:source.impersonatedBy, adminSession:source.adminSession }
    );
    const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens, undefined, authTokens.refreshTtl);

    const response = NextResponse.redirect(destination, { status: 302 });
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
