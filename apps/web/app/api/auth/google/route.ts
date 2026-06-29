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
// "exp+zobia:" and "exp+zobia-social:" are Expo Go development variants of the
// custom scheme — allowed in all environments so dev builds can complete OAuth.
const ALLOWED_REDIRECT_SCHEMES = ["zobia:", "exp+zobia:", "exp+zobia-social:"];

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
    if (captchaProvider !== "none") {
      if (captchaToken) {
        const captchaOk = await verifyCaptcha(captchaToken, ip ?? undefined);
        if (!captchaOk) {
          throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
        }
      } else if (process.env.NODE_ENV === "production") {
        throw badRequest("CAPTCHA token is required.", "CAPTCHA_REQUIRED");
      }
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

    // Both mobile and web: always redirect to Google so the browser (Custom Tab
    // on Android, or the regular browser on web) stores the CSRF and mobile-
    // redirect cookies natively. Returning JSON to the Expo app and then opening
    // the URL in a Custom Tab caused the cookies to be set only on the Axios
    // client (which has no cookie jar) — not in Chrome Custom Tab — so the
    // zobia_csrf_state cookie was absent from the callback request and the CSRF
    // check failed with "session_expired". The fix: let the Custom Tab navigate
    // to this endpoint itself; the browser commits the Set-Cookie headers before
    // following the redirect to Google, so the callback always receives them.
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
