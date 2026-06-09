export const dynamic = 'force-dynamic';

/**
 * app/api/auth/google/route.ts
 *
 * Google OAuth initiation endpoint.
 *
 * GET /api/auth/google
 *   - Generates a CSRF state token
 *   - Stores it in a short-lived HttpOnly cookie
 *   - Returns the Google OAuth consent screen URL
 *
 * The client should redirect the user to the returned `url`.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthUrl } from "@/lib/auth/google";
import { generateCsrfToken, buildCsrfCookie } from "@/lib/security/csrf";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyCaptcha, getCaptchaProvider } from "@/lib/security/captcha";

// ---------------------------------------------------------------------------
// GET /api/auth/google
// ---------------------------------------------------------------------------

/**
 * Initiate the Google OAuth flow.
 *
 * Generates a CSRF state token, stores it in a short-lived HttpOnly cookie,
 * and returns the full Google OAuth authorisation URL for the client to
 * redirect the browser to.
 *
 * @returns JSON { url: string } – the Google consent screen URL
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Rate limit by IP to prevent abuse
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    // CAPTCHA verification — token passed as query param ?captcha_token=...
    const captchaToken = req.nextUrl.searchParams.get("captcha_token");
    const captchaProvider = await getCaptchaProvider();
    if (captchaToken) {
      const captchaOk = await verifyCaptcha(captchaToken, ip ?? undefined);
      if (!captchaOk) {
        throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
      }
    } else if (captchaProvider !== "none" && process.env.NODE_ENV === "production") {
      throw badRequest("CAPTCHA token is required.", "CAPTCHA_REQUIRED");
    }

    // Generate and store CSRF state token
    const state = generateCsrfToken();
    const csrfCookie = buildCsrfCookie(state);

    // Build the Google OAuth URL with state embedded
    const url = buildGoogleAuthUrl(state);

    // For mobile clients (?platform=mobile&redirect=app://...) store the
    // deep-link redirect URI in an HttpOnly cookie so the callback can
    // return the JWT directly to the app instead of setting a web cookie.
    const mobileRedirect = req.nextUrl.searchParams.get("redirect");
    const secure = process.env.NODE_ENV === "production";
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;
    const cookies = mobileRedirect
      ? [`${csrfCookie}`, `zobia_mobile_redirect=${encodeURIComponent(mobileRedirect)}; ${cookieFlags}`]
      : [csrfCookie];

    const response = NextResponse.json({ url }, { status: 200 });
    for (const cookie of cookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
