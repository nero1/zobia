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
import { verifyCaptcha } from "@/lib/security/captcha";

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
    const isDev = process.env.NODE_ENV !== "production";
    if (captchaToken) {
      const captchaOk = await verifyCaptcha(captchaToken, ip ?? undefined);
      if (!captchaOk) {
        throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
      }
    } else if (!isDev) {
      const { getManifestValue } = await import("@/lib/manifest");
      const captchaProvider = await getManifestValue("captcha_provider");
      // Only enforce CAPTCHA when it's explicitly configured (recaptcha or turnstile).
      // null means no row in x_manifest → captcha not set up yet → allow through.
      if (captchaProvider && captchaProvider !== "none") {
        throw badRequest("CAPTCHA token is required.", "CAPTCHA_REQUIRED");
      }
    }

    // Generate and store CSRF state token
    const state = generateCsrfToken();
    const csrfCookie = buildCsrfCookie(state);

    // Build the Google OAuth URL with state embedded
    const url = buildGoogleAuthUrl(state);

    return NextResponse.json(
      { url },
      {
        status: 200,
        headers: {
          "Set-Cookie": csrfCookie,
        },
      }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
