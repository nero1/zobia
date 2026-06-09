export const dynamic = 'force-dynamic';

/**
 * app/api/auth/telegram/callback/route.ts
 *
 * Telegram Login Widget callback handler.
 *
 * GET /api/auth/telegram/callback?id=...&first_name=...&hash=...&auth_date=...
 *   1. Validates Telegram's HMAC-SHA256 hash signature using the bot token
 *   2. Rejects payloads older than 10 minutes (replay protection)
 *   3. Creates or retrieves the platform user record from the database
 *   4. Issues a platform JWT
 *   5. Sets HttpOnly cookies with access + refresh tokens
 *   6. Redirects to /home or /onboarding
 *
 * Reference: https://core.telegram.org/widgets/login#checking-authorization
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyTelegramLogin,
  parseTelegramParams,
} from "@/lib/auth/telegram";
import { createSession, buildCookieHeaders } from "@/lib/auth/session";
import { db } from "@/lib/db";
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

/**
 * Upsert a user record from Telegram profile data.
 * Telegram users do not have an email, so email is stored as null.
 *
 * @param profile - Verified Telegram profile
 * @returns Existing or newly created user row
 */
async function upsertTelegramUser(profile: {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}): Promise<UserRow> {
  // Check if user already exists with this Telegram ID
  const existing = await db.query<UserRow>(
    `SELECT id, email, username, is_admin, onboarding_completed
     FROM users
     WHERE telegram_id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [profile.telegramId]
  );

  if (existing.rows[0]) return existing.rows[0];

  // Build display name from Telegram profile
  const displayName = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(" ");

  // Create new user
  const inserted = await db.query<UserRow>(
    `INSERT INTO users (
       telegram_id, display_name, avatar_url, onboarding_completed,
       is_admin, created_at, updated_at
     )
     VALUES ($1, $2, $3, false, false, NOW(), NOW())
     RETURNING id, email, username, is_admin, onboarding_completed`,
    [profile.telegramId, displayName, profile.photoUrl ?? null]
  );

  if (!inserted.rows[0]) {
    throw new Error("Failed to create user record for Telegram login");
  }

  return inserted.rows[0];
}

// ---------------------------------------------------------------------------
// GET /api/auth/telegram/callback
// ---------------------------------------------------------------------------

/**
 * Handle the Telegram Login Widget callback.
 *
 * Validates the Telegram hash signature, upserts the user,
 * issues a platform JWT, sets HttpOnly cookies, and redirects.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const { searchParams } = new URL(req.url);

    // Parse Telegram login params from query string
    const telegramData = parseTelegramParams(searchParams);
    if (!telegramData) {
      throw badRequest(
        "Missing required Telegram login parameters (id, first_name, hash, auth_date)"
      );
    }

    // Verify the Telegram HMAC-SHA256 signature and payload freshness
    let profile;
    try {
      profile = verifyTelegramLogin(telegramData);
    } catch (err) {
      throw unauthorized(
        `Telegram verification failed: ${(err as Error).message}`
      );
    }

    // Upsert user in database
    const user = await upsertTelegramUser(profile);

    // Create platform session
    const authTokens = await createSession(
      {
        id: user.id,
        email: user.email ?? "",
        username: user.username ?? profile.username ?? "",
        is_admin: user.is_admin,
      },
      { ip }
    );

    // Build cookie headers
    const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);

    // Redirect to appropriate post-auth destination
    const destination = user.onboarding_completed
      ? new URL("/home", env.NEXT_PUBLIC_APP_URL)
      : new URL("/onboarding", env.NEXT_PUBLIC_APP_URL);

    const response = NextResponse.redirect(destination, { status: 302 });
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
