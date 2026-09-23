export const dynamic = 'force-dynamic';

/**
 * app/api/auth/silent-refresh/route.ts
 *
 * GET /api/auth/silent-refresh?to=/intended-path
 *
 * Used by the Edge Middleware to silently refresh an expired access token
 * when a page navigation occurs and only a valid refresh token is present.
 *
 * Flow:
 *  1. Read `zobia_rt` refresh token cookie.
 *  2. Call refreshAccessToken() to issue new tokens.
 *  3. On success: set new cookies and redirect to `?to` (validated) or /home.
 *  4. On failure: redirect to /auth/login?redirect=<to>&reason=session_expired.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  refreshAccessToken,
  buildCookieHeaders,
  buildClearCookieHeaders,
  REFRESH_TOKEN_COOKIE,
  SessionRevokedError,
} from "@/lib/auth/session";
import { JwtVerificationError } from "@/lib/auth/jwt";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

/**
 * Redirect to the login screen with a cleared cookie jar.
 *
 * BUG: persistent "session expired" popup — previously this route redirected
 * to /auth/login on a failed refresh WITHOUT clearing the dead zobia_rt/zobia_at
 * cookies. The browser kept sending that same dead refresh token on every
 * subsequent page load / new tab, so this route (and the edge middleware that
 * calls it) kept redirecting to the session-expired login screen forever —
 * even for a different person opening the site fresh on a shared device.
 * Clearing the cookies here breaks that loop: the next load has no refresh
 * token and goes straight to a normal (non-"expired") login page.
 */
function redirectToLoginClearingCookies(loginUrl: URL): NextResponse {
  const response = NextResponse.redirect(loginUrl);
  const { accessCookie, refreshCookie } = buildClearCookieHeaders();
  response.headers.append("Set-Cookie", accessCookie);
  response.headers.append("Set-Cookie", refreshCookie);
  return response;
}

/** Validate that a redirect target is a relative same-site path. */
function isSafeRelativePath(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\/[^/]/.test(value);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const to = req.nextUrl.searchParams.get("to");
  const safeTo = isSafeRelativePath(to) ? to : "/home";

  const loginUrl = new URL("/auth/login", req.url);
  loginUrl.searchParams.set("redirect", safeTo);
  loginUrl.searchParams.set("reason", "session_expired");

  try {
    // Rate limit by IP. A 429 here is transient (nothing wrong with the
    // refresh token itself), so it deliberately falls through to the
    // catch-all below WITHOUT clearing cookies — the next attempt should
    // still have a working refresh token.
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    if (!refreshToken) {
      // No refresh token to begin with — nothing to clear, just send them to
      // log in normally.
      return NextResponse.redirect(loginUrl);
    }

    let result;
    try {
      result = await refreshAccessToken(refreshToken);
    } catch (err) {
      // Only a genuinely dead token (invalid/expired/revoked) should clear
      // the cookie jar — see redirectToLoginClearingCookies's doc comment.
      // Any other failure (lock contention, a DB hiccup) leaves the cookies
      // alone since the same token may still work on the next attempt.
      if (err instanceof JwtVerificationError || err instanceof SessionRevokedError) {
        return redirectToLoginClearingCookies(loginUrl);
      }
      throw err;
    }

    // Build full AuthTokens-compatible object for buildCookieHeaders
    const authTokens = {
      accessToken: result.accessToken,
      refreshToken: result.newRefreshToken ?? refreshToken,
      expiresIn: result.expiresIn,
      refreshTtl: result.refreshTtl,
    };

    const { accessCookie, refreshCookie } = buildCookieHeaders(
      authTokens,
      process.env.NODE_ENV === "production",
      result.refreshTtl
    );

    const destination = new URL(safeTo, req.url);
    const response = NextResponse.redirect(destination, { status: 302 });
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    return response;
  } catch {
    return NextResponse.redirect(loginUrl);
  }
}
