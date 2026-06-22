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
import { env } from "@/lib/env";

// Only these schemes/hosts may be stored as the post-OAuth deep-link redirect target.
// Prevents token exfiltration to attacker-controlled URLs (ZB-01).
const ALLOWED_REDIRECT_SCHEMES = ["zobia:", "exp:"];

function isRedirectAllowed(redirect: string): boolean {
  try {
    const url = new URL(redirect);
    if (ALLOWED_REDIRECT_SCHEMES.includes(url.protocol)) return true;
    // Allow https redirects back to our own app origin only
    if (url.protocol === "https:" || url.protocol === "http:") {
      const appOrigin = env.NEXT_PUBLIC_APP_URL;
      if (appOrigin) {
        const appHost = new URL(appOrigin).hostname;
        if (url.hostname === appHost) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

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
  const origin = new URL(req.url).origin;
  // Read mobileRedirect early so error handling can decide whether to return
  // JSON (mobile) or redirect to an error page (web browser navigation).
  const mobileRedirect = req.nextUrl.searchParams.get("redirect");

  // For web browsers that navigate directly to this URL (no ?redirect param),
  // errors should redirect to the login page with an error code rather than
  // returning raw JSON that would display as plain text in the browser.
  const webErrorRedirect = (code: string) =>
    NextResponse.redirect(new URL(`/auth/login?error=${encodeURIComponent(code)}`, origin), { status: 302 });

  try {
    // Rate limit by IP to prevent abuse
    const ip = getClientIp(req);
    try {
      await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);
    } catch {
      if (mobileRedirect) return handleApiError(new Error("Rate limited"));
      return webErrorRedirect("rate_limited");
    }

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

    if (mobileRedirect && !isRedirectAllowed(mobileRedirect)) {
      throw badRequest("Invalid redirect target.", "INVALID_REDIRECT");
    }
    const secure = process.env.NODE_ENV === "production";
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;
    const cookies: string[] = [csrfCookie];
    if (mobileRedirect) {
      cookies.push(`zobia_mobile_redirect=${encodeURIComponent(mobileRedirect)}; ${cookieFlags}`);
    }

    // For web clients that have a post-login redirect destination (e.g. after
    // silent-refresh failure), store the target path in an HttpOnly cookie so
    // the callback handler can redirect there instead of defaulting to /home.
    const webRedirect = req.nextUrl.searchParams.get("web_redirect");
    if (typeof webRedirect === "string" && /^\/[^/]/.test(webRedirect)) {
      cookies.push(`zobia_web_redirect=${encodeURIComponent(webRedirect)}; ${cookieFlags}`);
    }

    // Mobile flow: return JSON so the Expo app can open the URL itself.
    // Web flow: redirect directly to Google — this is more robust than returning
    // JSON because the CSRF cookie is set in the same response that initiates
    // the redirect chain. The browser's native navigation handling commits the
    // cookie before following the redirect to Google, so the callback request
    // always includes it. This prevents the "session_expired" bug that occurred
    // when a ServiceWorker intercepted the old JSON fetch and dropped Set-Cookie.
    if (mobileRedirect) {
      const response = NextResponse.json({ url }, { status: 200 });
      for (const cookie of cookies) {
        response.headers.append("Set-Cookie", cookie);
      }
      return response;
    }

    const response = NextResponse.redirect(url, { status: 302 });
    for (const cookie of cookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (err) {
    // Mobile: return standard JSON error; Web: redirect to login with error code
    if (mobileRedirect) return handleApiError(err);
    const code = (err as { code?: string }).code ?? "oauth_failed";
    return webErrorRedirect(code);
  }
}
