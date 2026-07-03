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
import { db } from "@/lib/db";
import { createSession, buildCookieHeaders } from "@/lib/auth/session";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { handleApiError } from "@/lib/api/errors";

// Path-only, no query strings or fragments — same allowlist shape as the
// OAuth web-redirect SAFE_REDIRECT_RE in app/api/auth/google/callback/route.ts.
const SAFE_REDIRECT_RE = /^\/[a-zA-Z0-9/_-]*$/;

interface UserRow {
  id: string;
  email: string | null;
  username: string;
  is_admin: boolean;
  is_moderator: boolean;
  is_creator: boolean;
  onboarding_completed: boolean;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.oauthCallback);

    const reqOrigin = new URL(req.url).origin;
    const code = req.nextUrl.searchParams.get("code");
    const redirectParam = req.nextUrl.searchParams.get("redirect");
    const safeRedirect = redirectParam && SAFE_REDIRECT_RE.test(redirectParam) ? redirectParam : "/home";

    if (!code) {
      return NextResponse.redirect(new URL("/auth/login", reqOrigin), { status: 302 });
    }

    // Atomic single-use consume — a replayed/guessed code fails from here on.
    const userId = await redis.getdel(`mobile_bridge:${code}`);
    if (!userId) {
      return NextResponse.redirect(new URL("/auth/login", reqOrigin), { status: 302 });
    }

    const { rows } = await db.query<UserRow>(
      `SELECT id, email, username, is_admin, is_moderator, is_creator, onboarding_completed
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const user = rows[0];
    if (!user) {
      return NextResponse.redirect(new URL("/auth/login", reqOrigin), { status: 302 });
    }

    const authTokens = await createSession(user, { ip });
    const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);

    const destination = new URL(safeRedirect, reqOrigin);
    const response = NextResponse.redirect(destination, { status: 302 });
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
