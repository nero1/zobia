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
import { refreshAccessToken, buildCookieHeaders, REFRESH_TOKEN_COOKIE } from "@/lib/auth/session";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

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
    // Rate limit by IP
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    if (!refreshToken) {
      return NextResponse.redirect(loginUrl);
    }

    const result = await refreshAccessToken(refreshToken);

    // Build full AuthTokens-compatible object for buildCookieHeaders
    const authTokens = {
      accessToken: result.accessToken,
      refreshToken: result.newRefreshToken ?? refreshToken,
      expiresIn: result.expiresIn,
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
