export const dynamic = 'force-dynamic';

/**
 * app/api/auth/refresh/route.ts
 *
 * JWT token refresh endpoint.
 *
 * POST /api/auth/refresh
 *   1. Reads the refresh token from the HttpOnly `zobia_rt` cookie
 *   2. Validates the token signature and expiry with jose
 *   3. Confirms the session still exists in Redis (not revoked)
 *   4. Issues a new access token
 *   5. Updates the access token cookie
 *   6. Returns { expiresIn } for client-side scheduling
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  refreshAccessToken,
  buildCookieHeaders,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/auth/session";
import { JwtVerificationError } from "@/lib/auth/jwt";
import { handleApiError, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

/**
 * POST /api/auth/refresh
 *
 * Exchange a valid refresh token for a new access token.
 * The refresh token is read from the HttpOnly cookie set during login.
 * On success a new access cookie is set and the refresh cookie is preserved.
 *
 * @returns JSON { expiresIn: number } – seconds until the new access token expires
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(request);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    // Accept refresh token from cookie (web) or X-Refresh-Token header (mobile)
    const refreshToken =
      request.cookies.get(REFRESH_TOKEN_COOKIE)?.value ??
      request.headers.get("x-refresh-token") ??
      undefined;

    if (!refreshToken) {
      throw unauthorized("No refresh token present");
    }

    // Validate token and confirm session in Redis; get new access token
    const { accessToken, expiresIn } = await refreshAccessToken(refreshToken);

    // Build updated access cookie (refresh cookie stays the same)
    const { accessCookie } = buildCookieHeaders({
      accessToken,
      refreshToken, // reuse existing refresh token
      expiresIn,
    });

    const response = NextResponse.json({ expiresIn }, { status: 200 });
    response.headers.set("Set-Cookie", accessCookie);
    // Also expose the new access token in a header for mobile clients
    response.headers.set("X-Access-Token", accessToken);
    return response;
  } catch (err) {
    // Surface JWT-specific error codes for the client to act on
    if (err instanceof JwtVerificationError) {
      const status = err.code === "EXPIRED" ? 401 : 400;
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status }
      );
    }
    return handleApiError(err);
  }
}
