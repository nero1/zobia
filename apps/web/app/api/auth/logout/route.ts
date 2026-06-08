export const dynamic = 'force-dynamic';

/**
 * app/api/auth/logout/route.ts
 *
 * Logout endpoint.
 *
 * POST /api/auth/logout
 *   1. Reads the access token from the HttpOnly cookie or Authorization header
 *   2. Deletes the session from Redis for immediate invalidation of all tokens
 *   3. Clears both HttpOnly auth cookies (access + refresh)
 *
 * Logout is always considered successful – even if the token is expired or
 * missing – so the client always ends up in a logged-out state.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  invalidateSession,
  buildClearCookieHeaders,
  ACCESS_TOKEN_COOKIE,
} from "@/lib/auth/session";
import {
  verifyAccessToken,
  extractBearerToken,
  JwtVerificationError,
} from "@/lib/auth/jwt";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

/**
 * POST /api/auth/logout
 *
 * Revokes the current session in Redis and clears all auth cookies.
 * Always returns 200 so the client always ends up logged out.
 *
 * @returns JSON { success: true }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(request);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);
  } catch {
    // Rate-limit errors are non-fatal for logout – always clear cookies
  }

  // Try to get the access token from cookie or Authorization header
  const cookieToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const headerToken = extractBearerToken(request.headers.get("authorization"));
  const token = cookieToken ?? headerToken;

  const { accessCookie, refreshCookie } = buildClearCookieHeaders();

  if (token) {
    try {
      const payload = await verifyAccessToken(token);
      // Delete session from Redis immediately – all tokens for this session
      // become invalid on the next request that checks Redis.
      if (payload.sid && payload.sub) {
        await invalidateSession(payload.sid, payload.sub);
      }
    } catch (err) {
      // Expired token is fine – we still want to clear the cookies.
      // Only log unexpected errors.
      if (!(err instanceof JwtVerificationError)) {
        console.error("[api:auth:logout] Error invalidating session", err);
      }
    }
  }

  const response = NextResponse.json({ success: true }, { status: 200 });
  response.headers.append("Set-Cookie", accessCookie);
  response.headers.append("Set-Cookie", refreshCookie);
  return response;
}
