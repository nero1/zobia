import { authFailureLogDetails } from "@/lib/db/errorCode";
import { authReturnDestination } from "@/lib/auth/returnDestination";
export const dynamic = 'force-dynamic';
const SAFE_REDIRECT_RE = /^\/(?!\/)[a-zA-Z0-9/_-]*$/;

/**
 * app/api/auth/google/callback/route.ts
 *
 * Google OAuth callback handler.
 *
 * GET /api/auth/google/callback?code=...&state=...
 *   1. Verifies the `state` param against the CSRF cookie to prevent CSRF
 *   2. Exchanges the authorisation code for Google tokens
 *   3. Fetches the user's Google profile
 *   4. Creates or retrieves the platform user record from the database
 *   5. Issues a platform JWT (NOT Supabase auth)
 *   6. Stores the Google refresh token in Redis against the session
 *   7a. Web:    Sets HttpOnly cookies and redirects to /home or /onboarding
 *   7b. Mobile: Redirects to the app deep-link with token + user payload
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import {
  exchangeGoogleCode,
  fetchGoogleUserProfile,
} from "@/lib/auth/google";
import {
  createSession,
  rotateSession,
  buildCookieHeaders,
  ACCESS_TOKEN_COOKIE,
} from "@/lib/auth/session";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/jwt";
import { redis } from "@/lib/redis";
import {upsertGoogleUser} from "@/lib/auth/googleAccount";
import { getManifestValue } from "@/lib/manifest";
import {
  validateCsrfState,
  clearCsrfCookie,
} from "@/lib/security/csrf";
import { badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, getUserAgent, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { issueAppealToken } from "@/lib/auth/appealToken";
import { ApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Query param schema
// ---------------------------------------------------------------------------

const CallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

// Only these schemes/hosts may be used as post-OAuth deep-link redirect targets (ZB-01).
// "exp+zobia:" and "exp+zobia-social:" are Expo Go development scheme variants.
const ALLOWED_REDIRECT_SCHEMES = ["zobia:", "exp+zobia:", "exp+zobia-social:"];

function isRedirectAllowed(redirect: string): boolean {
  try {
    const url = new URL(redirect);
    if (ALLOWED_REDIRECT_SCHEMES.includes(url.protocol)) return true;
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
// Types
// ---------------------------------------------------------------------------

/** Store Google's refresh token in Redis keyed to the session. */
async function storeGoogleRefreshToken(
  userId: string,
  refreshToken: string
): Promise<void> {
  await redis.setex(
    `google_rt:user:${userId}`,
    180 * 24 * 3600,
    refreshToken
  );
}

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback
// ---------------------------------------------------------------------------

/** Build a Set-Cookie header that clears the named cookie. */
function clearCookie(name: string, secure: boolean): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Redirect to the auth error page, always clearing all OAuth-related cookies. */
function authErrorRedirect(
  req: NextRequest,
  errorCode: string,
  statusCode = 302
): NextResponse {
  const origin = new URL(req.url).origin;
  const secure = process.env.NODE_ENV === "production";
  const dest = new URL(`/auth/error?code=${encodeURIComponent(errorCode)}`, origin);
  const res = NextResponse.redirect(dest, { status: statusCode });
  for (const name of ["zobia_csrf_state", "zobia_mobile_redirect", "zobia_web_redirect"]) {
    res.headers.append("Set-Cookie", clearCookie(name, secure));
  }
  return res;
}

/**
 * If the incoming request already carries a valid, fully-authenticated
 * session cookie, the browser has already completed this OAuth flow
 * successfully — most likely a duplicate/prefetched GET to this one-time-use
 * callback URL racing the real navigation (browsers may preload/re-fire a
 * redirect target — e.g. Chrome's "preload pages", or a Custom Tab retry).
 * The duplicate request finds the CSRF cookie already cleared (or the
 * authorization code already consumed by the real request) and would
 * otherwise show a false "session expired" error to a user who is, in
 * fact, already signed in. Detect that and send them where they were
 * headed instead of showing the error.
 */
async function alreadyAuthenticatedRedirect(
  req: NextRequest,
  origin: string
): Promise<NextResponse | null> {
  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = await verifyAccessToken(token);
    if (!payload?.sub || payload.type === "pre_auth") return null;
    const webRedirectRaw = req.cookies.get("zobia_web_redirect")?.value;
    const webRedirect = webRedirectRaw ? decodeURIComponent(webRedirectRaw) : null;
    const destination = webRedirect && SAFE_REDIRECT_RE.test(webRedirect)
      ? new URL(webRedirect, origin)
      : new URL("/home", origin);
    return NextResponse.redirect(destination, { status: 302 });
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = new URL(req.url).origin;
  const secure = process.env.NODE_ENV === "production";

  try {
    const ip = getClientIp(req);
    const ua = getUserAgent(req);
    try {
      await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);
    } catch {
      return authErrorRedirect(req, "rate_limited");
    }

    const { searchParams } = new URL(req.url);
    const error = searchParams.get("error");

    // Google-side errors (e.g. user denied access)
    if (error) {
      const res = NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(error)}`, origin)
      );
      for (const name of ["zobia_csrf_state", "zobia_mobile_redirect", "zobia_web_redirect"]) {
        res.headers.append("Set-Cookie", clearCookie(name, secure));
      }
      return res;
    }

    // Validate required query params with Zod before any processing
    const paramsParsed = CallbackQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!paramsParsed.success) {
      return authErrorRedirect(req, "invalid_request");
    }
    const { code, state } = paramsParsed.data;

    // Verify CSRF state — cookie may have expired (user paused on Google's page)
    const cookieHeader = req.headers.get("cookie");
    const csrfValid = validateCsrfState(cookieHeader, state);
    if (!csrfValid) {
      const already = await alreadyAuthenticatedRedirect(req, origin);
      if (already) return already;
      return authErrorRedirect(req, "session_expired");
    }

    // Read the optional mobile deep-link redirect stored during auth initiation
    const mobileRedirectRaw = req.cookies.get("zobia_mobile_redirect")?.value;
    const mobileRedirect = mobileRedirectRaw ? decodeURIComponent(mobileRedirectRaw) : null;
    // ZB-01: Validate the stored redirect target before using it
    if (mobileRedirect && !isRedirectAllowed(mobileRedirect)) {
      throw badRequest("Invalid redirect target.", "INVALID_REDIRECT");
    }

    // Read the optional web redirect destination stored during auth initiation
    const webRedirectRaw = req.cookies.get("zobia_web_redirect")?.value;
    const webRedirect = webRedirectRaw ? decodeURIComponent(webRedirectRaw) : null;

    // Exchange code for tokens
    const tokens = await exchangeGoogleCode(code);

    // Fetch Google user profile
    const profile = await fetchGoogleUserProfile(tokens.access_token);

    // ZB-08: Reject logins from Google accounts whose email hasn't been verified
    if (!profile.emailVerified) {
      throw badRequest("Google account email is not verified. Please verify your email with Google and try again.", "EMAIL_NOT_VERIFIED");
    }

    // Upsert user in database
    const user = await upsertGoogleUser({
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    });

    // Store Google refresh token in Redis
    if (tokens.refresh_token) {
      await storeGoogleRefreshToken(user.id, tokens.refresh_token);
    }

    const reqOrigin = new URL(req.url).origin;
    const clearMobileCookie = "zobia_mobile_redirect=; Max-Age=0; Path=/; HttpOnly";
    const clearWebRedirectCookie = "zobia_web_redirect=; Max-Age=0; Path=/; HttpOnly";
    const cookiesToClear = [clearCsrfCookie(), clearMobileCookie, clearWebRedirectCookie];

    // -----------------------------------------------------------------
    // 2FA gate: if user has TOTP enabled, issue a pre-auth token
    // -----------------------------------------------------------------
    const [twoFaRaw, twoFaModsRaw] = await Promise.all([
      getManifestValue("auth_2fa_enabled"),
      getManifestValue("auth_2fa_required_for_mods"),
    ]);
    const twoFaGloballyEnabled = twoFaRaw !== "false"; // default enabled
    const twoFaRequiredForMods = twoFaModsRaw === "true"; // default disabled

    const needsTwoFaVerify = (twoFaGloballyEnabled || user.is_admin) && user.totp_enabled;
    const mustSetUp2Fa = twoFaRequiredForMods && user.is_moderator && !user.is_admin && !user.totp_enabled;

    if (mustSetUp2Fa) {
      // Moderator who hasn't set up 2FA — block and redirect to require page
      const destination = new URL("/auth/require-2fa", reqOrigin);
      const response = NextResponse.redirect(destination, { status: 302 });
      for (const cookie of cookiesToClear) response.headers.append("Set-Cookie", cookie);
      return response;
    }

    if (needsTwoFaVerify) {
      // Issue a 5-minute pre-auth token and redirect to the 2FA verify page
      const preAuthToken = await signAccessToken(
        { sub: user.id, email: user.email, username: user.username ?? "", is_admin: user.is_admin, sid: "pre_auth", type: "pre_auth", auth_provider: "google", ...(webRedirect && SAFE_REDIRECT_RE.test(webRedirect) ? {return_to:webRedirect} : {}) },
        5 * 60
      );
      await redis.setex(`pre_auth:${user.id}`, 5 * 60, preAuthToken);

      if (mobileRedirect) {
        // Use an opaque code in the deep-link URL instead of the raw token to prevent
        // the token from being captured in logs, referrer headers, or OS app-switcher history.
        const { randomBytes } = await import("crypto");
        const preAuthCode = randomBytes(32).toString("hex");
        await redis.setex(`mobile_pre_auth:${preAuthCode}`, 300, preAuthToken);
        const deepLink = new URL(mobileRedirect);
        deepLink.searchParams.set("pre_auth_code", preAuthCode);
        deepLink.searchParams.set("requires_2fa", "true");
        const response = NextResponse.redirect(deepLink.toString(), { status: 302 });
        for (const cookie of cookiesToClear) response.headers.append("Set-Cookie", cookie);
        return response;
      }

      const destination = new URL("/auth/2fa", reqOrigin);
      const preAuthCode = crypto.randomBytes(32).toString("hex");
      await redis.setex(`web_pre_auth:${preAuthCode}`, 300, preAuthToken);
      destination.searchParams.set("code", preAuthCode);
      const response = NextResponse.redirect(destination, { status: 302 });
      for (const cookie of cookiesToClear) response.headers.append("Set-Cookie", cookie);
      return response;
    }

    // Create platform session (no 2FA required)
    const authTokens = await rotateSession(
      null,
      {
        id: user.id,
        email: user.email,
        username: user.username ?? "",
        is_admin: user.is_admin,
        is_moderator: user.is_moderator,
        is_creator: user.is_creator,
        onboarding_completed: user.onboarding_completed,
      },
      { ip, ua, authProvider:"google" }
    );

    // -----------------------------------------------------------------
    // Mobile flow: redirect to app deep-link with a one-time exchange code.
    // Tokens are stored in Redis under mobile_exchange:{code} (90s TTL).
    // The Expo app must POST to /api/auth/mobile-token with { code } to
    // receive the actual accessToken and refreshToken over HTTPS — never
    // exposed in the redirect URL.
    // -----------------------------------------------------------------
    if (mobileRedirect) {
      const exchangeCode = crypto.randomBytes(32).toString("hex");
      // BUG-EXPO-03: include all AuthUser fields so the mobile app has full user state
      const authUser = {
        id: user.id,
        email: user.email,
        username: user.username ?? "",
        displayName: user.display_name ?? user.username ?? "",
        avatarEmoji: user.avatar_emoji ?? "😎",
        avatar_url: user.avatar_url ?? null,
        city: user.city ?? "",
        xp: user.xp_total ?? 0,
        rankTier: user.rank_name ?? "Beginner",
        plan: (user.plan ?? "free") as "free" | "plus" | "pro" | "max",
        isAdmin: user.is_admin,
        is_admin: user.is_admin,
        isModerator: user.is_moderator,
        is_moderator: user.is_moderator,
        isCreator: user.is_creator,
        is_creator: user.is_creator,
        onboardingCompleted: user.onboarding_completed,
      };
      await redis.setex(
        `mobile_exchange:${exchangeCode}`,
        90,
        JSON.stringify({
          accessToken: authTokens.accessToken,
          refreshToken: authTokens.refreshToken,
          userId: user.id,
          onboardingCompleted: user.onboarding_completed,
          authUser,
        })
      );

      const deepLink = new URL(mobileRedirect);
      deepLink.searchParams.set("code", exchangeCode);

      const response = NextResponse.redirect(deepLink.toString(), { status: 302 });
      for (const cookie of cookiesToClear) {
        response.headers.append("Set-Cookie", cookie);
      }
      return response;
    }

    // -----------------------------------------------------------------
    // Web flow: set HttpOnly cookies and redirect to onboarding or home
    // -----------------------------------------------------------------
    const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);

    // BUG-35: Validate the redirect param as a same-origin relative path before use.
    // Rejects protocol-relative (//evil.com) and absolute (https://evil.com) values.
    // BUG-030 FIX: tighten the redirect allowlist regex from /^\/[^/]/ to
    // /^\/[a-zA-Z0-9\/_-]*$/ (path-only, no query strings or fragments).
    // The old regex allowed /?foo=bar which could carry XSS payloads in query params,
    // and //evil.com was only blocked by the [^/] constraint on the second char
    // (which would pass e.g. /auth?next=//evil.com). The new regex is stricter:
    // only alphanumeric characters, forward slashes, underscores, and hyphens
    // are allowed in the redirect path — no query strings, no fragments.
    const redirectParam = req.nextUrl.searchParams.get("redirect");
    const safeRedirect = typeof redirectParam === "string" && SAFE_REDIRECT_RE.test(redirectParam)
      ? redirectParam
      : null;

    // Web redirect cookie (set during /api/auth/google initiation) takes priority
    // over the default /home destination so users land where they were going.
    const requested = webRedirect && SAFE_REDIRECT_RE.test(webRedirect) ? webRedirect : safeRedirect;
    const destination = new URL(authReturnDestination(user.onboarding_completed,requested),reqOrigin);

    const response = NextResponse.redirect(destination, { status: 302 });
    for (const cookie of [accessCookie, refreshCookie, ...cookiesToClear]) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (err) {
    const errCode = (err as { code?: string }).code;
    logger.error(authFailureLogDetails(err), "[google-callback] Auth error");
    if (errCode === "ACCOUNT_BANNED" || errCode === "ACCOUNT_SUSPENDED") {
      const blocked = err as {
        userId: string;
        email: string | null;
        reason: string | null;
        suspendedUntil: string | null;
      };
      // Issue a short-lived appeal token — this login attempt just proved the
      // user's identity (verified Google profile), which is exactly the
      // condition the appeal pipeline requires before letting someone file one.
      const appealCode = await issueAppealToken({
        userId: blocked.userId,
        email: blocked.email,
        appealType: errCode === "ACCOUNT_BANNED" ? "ban" : "suspension",
        reason: blocked.reason,
        suspendedUntil: blocked.suspendedUntil,
      }).catch(() => null);

      const uiErrorCode = errCode === "ACCOUNT_BANNED" ? "account_terminated" : "account_suspended";

      // Mobile flow (Android/Expo Custom Tab): send the blocked-account
      // details back through the app's deep link instead of the web login
      // page, so the native app can render its own banner/appeal flow — the
      // cookie was set during /api/auth/google initiation and is still
      // present on this request even though the try block's own
      // `mobileRedirect` local isn't in scope here.
      const mobileRedirectRaw = req.cookies.get("zobia_mobile_redirect")?.value;
      const mobileRedirectCookie = mobileRedirectRaw ? decodeURIComponent(mobileRedirectRaw) : null;
      const dest = mobileRedirectCookie && isRedirectAllowed(mobileRedirectCookie)
        ? new URL(mobileRedirectCookie)
        : new URL(`/auth/login`, origin);
      dest.searchParams.set("error", uiErrorCode);
      if (blocked.reason) dest.searchParams.set("block_reason", blocked.reason);
      if (blocked.suspendedUntil) dest.searchParams.set("until", blocked.suspendedUntil);
      if (appealCode) dest.searchParams.set("appeal_code", appealCode);

      const res = NextResponse.redirect(dest, { status: 302 });
      for (const name of ["zobia_csrf_state", "zobia_mobile_redirect", "zobia_web_redirect"]) {
        res.headers.append("Set-Cookie", clearCookie(name, secure));
      }
      return res;
    }
    if (err instanceof ApiError && err.code === "RATE_LIMITED") {
      return authErrorRedirect(req, "rate_limited");
    }
    if(errCode==="ACCOUNT_LINK_REQUIRED")return authErrorRedirect(req,"account_link_required");
    if (errCode === "EMAIL_NOT_VERIFIED") {
      return authErrorRedirect(req, "email_not_verified");
    }
    if (errCode === "SIGNUPS_DISABLED") {
      return authErrorRedirect(req, "signups_disabled");
    }
    // Any other error (e.g. a duplicate/prefetched request reusing an
    // already-consumed Google authorization code): if the user already has a
    // valid session from a concurrent successful request, send them onward
    // instead of showing a scary error page.
    const already = await alreadyAuthenticatedRedirect(req, origin);
    if (already) return already;
    // Any other error: show a user-friendly error page (no raw JSON)
    return authErrorRedirect(req, "unexpected");
  }
}
