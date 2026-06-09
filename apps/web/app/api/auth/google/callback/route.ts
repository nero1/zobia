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
import {
  exchangeGoogleCode,
  fetchGoogleUserProfile,
} from "@/lib/auth/google";
import {
  createSession,
  buildCookieHeaders,
} from "@/lib/auth/session";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import {
  validateCsrfState,
  clearCsrfCookie,
} from "@/lib/security/csrf";
import { handleApiError, badRequest, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  username: string;
  is_admin: boolean;
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

/** Find a unique username by appending a numeric suffix if the base is taken. */
async function uniqueUsername(base: string): Promise<string> {
  const { rows } = await db.query<{ username: string }>(
    `SELECT username FROM users WHERE username LIKE $1 AND deleted_at IS NULL`,
    [`${base}%`]
  );
  const taken = new Set(rows.map((r) => r.username));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${Date.now()}`;
}

/** Upsert the user in the database, returning the existing or new record. */
async function upsertGoogleUser(profile: {
  googleId: string;
  email: string;
  name: string;
  picture: string;
}): Promise<UserRow> {
  // Check if a user with this Google ID already exists
  const existing = await db.query<UserRow>(
    `SELECT id, email, username, is_admin, onboarding_completed,
            display_name, avatar_emoji, city, xp_total, rank_name
     FROM users
     WHERE google_id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [profile.googleId]
  );

  if (existing.rows[0]) return existing.rows[0];

  // Check if email is already associated with a different account
  const emailMatch = await db.query<UserRow>(
    `SELECT id, email, username, is_admin, onboarding_completed,
            display_name, avatar_emoji, city, xp_total, rank_name
     FROM users
     WHERE email = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [profile.email]
  );

  if (emailMatch.rows[0]) {
    // Link Google ID to the existing email account
    await db.query(
      `UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2), updated_at = NOW()
       WHERE id = $3`,
      [profile.googleId, profile.picture, emailMatch.rows[0].id]
    );
    return emailMatch.rows[0];
  }

  // Generate a unique username derived from the email
  const username = await uniqueUsername(baseUsernameFromEmail(profile.email));

  // Create a brand-new user (onboarding not yet complete)
  const inserted = await db.query<UserRow>(
    `INSERT INTO users (google_id, email, username, display_name, avatar_url, onboarding_completed, is_admin, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, false, false, NOW(), NOW())
     RETURNING id, email, username, is_admin, onboarding_completed,
               display_name, avatar_emoji, city, xp_total, rank_name`,
    [profile.googleId, profile.email, username, profile.name, profile.picture]
  );

  if (!inserted.rows[0]) {
    throw new Error("Failed to create user record");
  }

  return inserted.rows[0];
}

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Google-side errors (e.g. user denied access)
    if (error) {
      return NextResponse.redirect(
        new URL(`/auth/login?error=${encodeURIComponent(error)}`, env.NEXT_PUBLIC_APP_URL)
      );
    }

    if (!code) throw badRequest("Missing authorization code");

    // Verify CSRF state
    const cookieHeader = req.headers.get("cookie");
    const csrfValid = validateCsrfState(cookieHeader, state);
    if (!csrfValid) throw unauthorized("Invalid or missing CSRF state token");

    // Read the optional mobile deep-link redirect stored during auth initiation
    const mobileRedirectRaw = req.cookies.get("zobia_mobile_redirect")?.value;
    const mobileRedirect = mobileRedirectRaw ? decodeURIComponent(mobileRedirectRaw) : null;

    // Exchange code for tokens
    const tokens = await exchangeGoogleCode(code);

    // Fetch Google user profile
    const profile = await fetchGoogleUserProfile(tokens.access_token);

    // Upsert user in database
    const user = await upsertGoogleUser({
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    });

    // Create platform session
    const authTokens = await createSession(
      {
        id: user.id,
        email: user.email,
        username: user.username ?? "",
        is_admin: user.is_admin,
      },
      { ip }
    );

    // Store Google refresh token in Redis
    if (tokens.refresh_token) {
      await storeGoogleRefreshToken(user.id, tokens.refresh_token);
    }

    const clearMobileCookie = "zobia_mobile_redirect=; Max-Age=0; Path=/; HttpOnly";
    const cookiesToClear = [clearCsrfCookie(), clearMobileCookie];

    // -----------------------------------------------------------------
    // Mobile flow: redirect to app deep-link with JWT + user payload
    // -----------------------------------------------------------------
    if (mobileRedirect) {
      const authUser = {
        id: user.id,
        username: user.username ?? "",
        avatarEmoji: user.avatar_emoji ?? "😎",
        city: user.city ?? "",
        xp: user.xp_total ?? 0,
        rankTier: "bronze",
      };
      const deepLink = new URL(mobileRedirect);
      deepLink.searchParams.set("token", authTokens.accessToken);
      deepLink.searchParams.set("refresh_token", authTokens.refreshToken);
      deepLink.searchParams.set("user", encodeURIComponent(JSON.stringify(authUser)));
      deepLink.searchParams.set("onboarding_completed", String(user.onboarding_completed));

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

    const destination = user.onboarding_completed
      ? new URL("/home", env.NEXT_PUBLIC_APP_URL)
      : new URL("/onboarding", env.NEXT_PUBLIC_APP_URL);

    const response = NextResponse.redirect(destination, { status: 302 });
    for (const cookie of [accessCookie, refreshCookie, ...cookiesToClear]) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
