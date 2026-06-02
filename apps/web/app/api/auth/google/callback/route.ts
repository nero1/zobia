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
 *   7. Sets HttpOnly cookies with access + refresh tokens
 *   8. Redirects to /home (if onboarded) or /onboarding
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Store Google's refresh token in Redis keyed to the session. */
async function storeGoogleRefreshToken(
  sid: string,
  refreshToken: string
): Promise<void> {
  // TTL matches Google's typical refresh token lifetime (6 months)
  await redis.setex(
    `google_rt:${sid}`,
    180 * 24 * 3600,
    refreshToken
  );
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
    `SELECT id, email, username, is_admin, onboarding_completed
     FROM users
     WHERE google_id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [profile.googleId]
  );

  if (existing.rows[0]) return existing.rows[0];

  // Check if email is already associated with a different account
  const emailMatch = await db.query<UserRow>(
    `SELECT id, email, username, is_admin, onboarding_completed
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

  // Create a brand-new user (onboarding not yet complete)
  const inserted = await db.query<UserRow>(
    `INSERT INTO users (google_id, email, display_name, avatar_url, onboarding_completed, is_admin, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, NOW(), NOW())
     RETURNING id, email, username, is_admin, onboarding_completed`,
    [profile.googleId, profile.email, profile.name, profile.picture]
  );

  if (!inserted.rows[0]) {
    throw new Error("Failed to create user record");
  }

  return inserted.rows[0];
}

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback
// ---------------------------------------------------------------------------

/**
 * Handle the Google OAuth callback.
 * Validates CSRF, exchanges code, upserts user, issues JWT, sets cookies,
 * and redirects to the correct post-auth destination.
 */
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

    // Create platform session (platform JWT, not Supabase)
    const authTokens = await createSession(
      {
        id: user.id,
        email: user.email,
        username: user.username ?? "",
        is_admin: user.is_admin,
      },
      { ip }
    );

    // Store Google refresh token in Redis against this session
    if (tokens.refresh_token) {
      // Extract sid from access token payload (already embedded by createSession)
      // We store it by user ID since we don't have sid here directly
      await redis.setex(
        `google_rt:user:${user.id}`,
        180 * 24 * 3600,
        tokens.refresh_token
      );
    }

    // Build cookie headers
    const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);

    // Determine redirect destination
    const destination = user.onboarding_completed
      ? new URL("/home", env.NEXT_PUBLIC_APP_URL)
      : new URL("/onboarding", env.NEXT_PUBLIC_APP_URL);

    return NextResponse.redirect(destination, {
      status: 302,
      headers: {
        "Set-Cookie": [accessCookie, refreshCookie, clearCsrfCookie()].join(
          ", "
        ),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
