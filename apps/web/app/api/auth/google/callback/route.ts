export const dynamic = 'force-dynamic';

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
} from "@/lib/auth/session";
import { signAccessToken } from "@/lib/auth/jwt";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { getManifestValue } from "@/lib/manifest";
import {
  validateCsrfState,
  clearCsrfCookie,
} from "@/lib/security/csrf";
import { handleApiError, badRequest, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Query param schema
// ---------------------------------------------------------------------------

const CallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

// Only these schemes/hosts may be used as post-OAuth deep-link redirect targets (ZB-01).
const ALLOWED_REDIRECT_SCHEMES = ["zobia:", "exp:"];

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

interface UserRow {
  id: string;
  email: string;
  username: string;
  google_id: string | null;
  is_email_verified: boolean | null;
  is_admin: boolean;
  is_moderator: boolean;
  is_banned: boolean;
  is_suspended: boolean;
  deleted_at: string | null;
  totp_enabled: boolean;
  onboarding_completed: boolean;
  display_name: string | null;
  avatar_emoji: string | null;
  city: string | null;
  xp_total: number;
  rank_name: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
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

/** Derive a base username from an email address (part before @, lowercased, non-alphanumeric stripped). */
function baseUsernameFromEmail(email: string): string {
  return email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) || "user";
}

// Maximum username length enforced by the DB schema constraint (BUG-58)
const DB_USERNAME_MAX_LENGTH = 30;

/** Find a unique username by appending a numeric suffix if the base is taken. */
async function uniqueUsername(base: string): Promise<string> {
  // Use exact match + numeric-suffix pattern to avoid over-fetching unrelated usernames (L-06)
  const { rows } = await db.query<{ username: string }>(
    `SELECT username FROM users
     WHERE (username = $1 OR username ~ ('^' || $1 || '[0-9]+$'))
       AND deleted_at IS NULL`,
    [base]
  );
  const taken = new Set(rows.map((r) => r.username));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const suffix = String(i);
    const candidate = `${base.slice(0, DB_USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Last-resort fallback: 4-char random suffix, sliced to fit
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base.slice(0, DB_USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
}

/** Upsert the user in the database, returning the existing or new record. */
async function upsertGoogleUser(profile: {
  googleId: string;
  email: string;
  name: string;
  picture: string;
}): Promise<UserRow> {
  // Check if a user with this Google ID already exists (including soft-deleted for reactivation)
  const existing = await db.query<UserRow>(
    `SELECT id, email, username, google_id, is_email_verified, is_admin, is_moderator,
            is_banned, is_suspended, deleted_at,
            totp_enabled, onboarding_completed, display_name, avatar_emoji, city, xp_total, rank_name
     FROM users
     WHERE google_id = $1
     LIMIT 1`,
    [profile.googleId]
  );

  if (existing.rows[0]) {
    const u = existing.rows[0];
    if (u.is_banned) throw Object.assign(new Error("Account is banned"), { code: "ACCOUNT_BANNED" });
    if (u.is_suspended) throw Object.assign(new Error("Account is suspended"), { code: "ACCOUNT_SUSPENDED" });
    // Reactivate if within grace period (soft-deleted but identifiers intact)
    if (u.deleted_at) {
      await db.query(
        `UPDATE users SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`,
        [u.id]
      );
    }
    return u;
  }

  // Check if email is already associated with a different account (no google_id match)
  const emailMatch = await db.query<UserRow>(
    `SELECT id, email, username, google_id, is_email_verified, is_admin, is_moderator,
            is_banned, is_suspended, deleted_at,
            totp_enabled, onboarding_completed, display_name, avatar_emoji, city, xp_total, rank_name
     FROM users
     WHERE email = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [profile.email]
  );

  if (emailMatch.rows[0]) {
    const u = emailMatch.rows[0];
    if (u.is_banned) throw Object.assign(new Error("Account is banned"), { code: "ACCOUNT_BANNED" });
    if (u.is_suspended) throw Object.assign(new Error("Account is suspended"), { code: "ACCOUNT_SUSPENDED" });

    // Only auto-link if the existing account's google_id is already set
    // (clean re-auth path — e.g. google_id was stored from a previous session).
    // If google_id is null the account was created via a different method
    // (email/password, Telegram, etc.) and auto-linking without confirmation
    // would allow account takeover via a verified-email claim from Google.
    // We allow linking only when the existing account's email is marked as
    // verified (email_verified = true), which indicates the user previously
    // proved ownership of that address on this platform.
    if (u.google_id !== null) {
      // google_id already set — this is a clean re-auth; allow it
      return u;
    }

    if (u.is_email_verified === true) {
      // Existing account has a verified email — safe to link Google ID
      await db.query(
        `UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2), updated_at = NOW()
         WHERE id = $3`,
        [profile.googleId, profile.picture, u.id]
      );
      return u;
    }

    // Existing account with unverified email and no google_id — do NOT auto-link.
    // Treat this as a new account to avoid account takeover.
    // Fall through to create a new user record below.
  }

  // Generate a unique username derived from the email
  const username = await uniqueUsername(baseUsernameFromEmail(profile.email));

  // Create a brand-new user (onboarding not yet complete).
  // Retry on unique-violation (23505) for username — uniqueUsername() may race.
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidateUsername = attempt === 0 ? username : await uniqueUsername(baseUsernameFromEmail(profile.email));
    try {
      const inserted = await db.query<UserRow>(
        `INSERT INTO users (google_id, email, username, display_name, avatar_url, onboarding_completed, is_admin, is_email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, false, false, true, NOW(), NOW())
         RETURNING id, email, username, google_id, is_email_verified, is_admin, is_moderator,
                   is_banned, is_suspended, deleted_at,
                   totp_enabled, onboarding_completed,
                   display_name, avatar_emoji, city, xp_total, rank_name`,
        [profile.googleId, profile.email, candidateUsername, profile.name, profile.picture]
      );
      if (inserted.rows[0]) return inserted.rows[0];
    } catch (insertErr) {
      const pgCode = (insertErr as { code?: string }).code;
      if (pgCode === "23505" && attempt < 2) continue;
      throw insertErr;
    }
  }

  throw new Error("Failed to create user record after retries");
}

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const { searchParams } = new URL(req.url);
    const error = searchParams.get("error");

    // Google-side errors (e.g. user denied access)
    if (error) {
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(error)}`, new URL(req.url).origin)
      );
    }

    // Validate required query params with Zod before any processing
    const paramsParsed = CallbackQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!paramsParsed.success) {
      return NextResponse.json({ data: null, error: "Invalid query params" }, { status: 400 });
    }
    const { code, state } = paramsParsed.data;

    // Verify CSRF state
    const cookieHeader = req.headers.get("cookie");
    const csrfValid = validateCsrfState(cookieHeader, state);
    if (!csrfValid) throw unauthorized("Invalid or missing CSRF state token");

    // Read the optional mobile deep-link redirect stored during auth initiation
    const mobileRedirectRaw = req.cookies.get("zobia_mobile_redirect")?.value;
    const mobileRedirect = mobileRedirectRaw ? decodeURIComponent(mobileRedirectRaw) : null;
    // ZB-01: Validate the stored redirect target before using it
    if (mobileRedirect && !isRedirectAllowed(mobileRedirect)) {
      throw badRequest("Invalid redirect target.", "INVALID_REDIRECT");
    }

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
    const cookiesToClear = [clearCsrfCookie(), clearMobileCookie];

    // -----------------------------------------------------------------
    // 2FA gate: if user has TOTP enabled, issue a pre-auth token
    // -----------------------------------------------------------------
    const [twoFaRaw, twoFaModsRaw] = await Promise.all([
      getManifestValue("auth_2fa_enabled"),
      getManifestValue("auth_2fa_required_for_mods"),
    ]);
    const twoFaGloballyEnabled = twoFaRaw !== "false"; // default enabled
    const twoFaRequiredForMods = twoFaModsRaw === "true"; // default disabled

    const needsTwoFaVerify = twoFaGloballyEnabled && user.totp_enabled;
    const mustSetUp2Fa = twoFaRequiredForMods && user.is_moderator && !user.totp_enabled;

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
        { sub: user.id, email: user.email, username: user.username ?? "", is_admin: user.is_admin, sid: "pre_auth", type: "pre_auth" },
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
      },
      { ip }
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
      const authUser = {
        id: user.id,
        username: user.username ?? "",
        avatarEmoji: user.avatar_emoji ?? "😎",
        city: user.city ?? "",
        xp: user.xp_total ?? 0,
        rankTier: "bronze",
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
    const redirectParam = req.nextUrl.searchParams.get("redirect");
    const safeRedirect = typeof redirectParam === "string" && /^\/[^/]/.test(redirectParam)
      ? redirectParam
      : null;

    const destination = safeRedirect
      ? new URL(safeRedirect, reqOrigin)
      : user.onboarding_completed
        ? new URL("/home", reqOrigin)
        : new URL("/onboarding", reqOrigin);

    const response = NextResponse.redirect(destination, { status: 302 });
    for (const cookie of [accessCookie, refreshCookie, ...cookiesToClear]) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ACCOUNT_BANNED" || code === "ACCOUNT_SUSPENDED") {
      const reqOrigin = new URL(req.url).origin;
      return NextResponse.redirect(
        new URL(`/auth/login?error=${code.toLowerCase()}`, reqOrigin),
        { status: 302 }
      );
    }
    return handleApiError(err);
  }
}
