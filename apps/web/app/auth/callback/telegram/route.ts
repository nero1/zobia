/**
 * app/auth/callback/telegram/route.ts
 *
 * Telegram Login callback handler.
 *
 * Flow:
 *   1. Parse and verify Telegram login payload (HMAC-SHA256)
 *   2. Upsert user in database
 *   3. Create session (JWT + Redis)
 *   4. Set httpOnly cookies and redirect to app
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  parseTelegramParams,
  verifyTelegramLogin,
} from "@/lib/auth/telegram";
import { createSession, buildCookieHeaders } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** Derive a username from Telegram profile data. */
function deriveUsername(data: {
  username?: string;
  firstName: string;
  telegramId: string;
}): string {
  if (data.username) return data.username.slice(0, 20).toLowerCase();
  const base = data.firstName.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 15);
  return `${base || "user"}${data.telegramId.slice(-4)}`;
}

/**
 * GET /auth/callback/telegram
 * Validates the Telegram Login Widget payload and creates a session.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  // Parse Telegram params
  const loginData = parseTelegramParams(searchParams);
  if (!loginData) {
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth_failed", request.url)
    );
  }

  try {
    // Verify the Telegram signature and freshness
    const profile = verifyTelegramLogin(loginData);

    // Upsert user in database
    const { rows } = await db.query<{
      id: string;
      email: string;
      username: string;
      is_admin: boolean;
      is_suspended: boolean;
    }>(
      `INSERT INTO users (telegram_id, display_name, avatar_url, username, email, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (telegram_id) DO UPDATE SET
         display_name = COALESCE(users.display_name, EXCLUDED.display_name),
         avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
         updated_at = NOW(),
         last_login_at = NOW()
       RETURNING id, COALESCE(email, '') AS email, username, is_admin, is_suspended`,
      [
        profile.telegramId,
        `${profile.firstName}${profile.lastName ? " " + profile.lastName : ""}`,
        profile.photoUrl ?? null,
        deriveUsername(profile),
        // Telegram users may not have email – use a placeholder until they add one
        `tg_${profile.telegramId}@noreply.zobia.social`,
      ]
    );

    const user = rows[0];
    if (!user) throw new Error("Failed to upsert user");

    if (user.is_suspended) {
      return NextResponse.redirect(
        new URL("/auth/login?error=account_suspended", request.url)
      );
    }

    // Create session
    const authTokens = await createSession(
      {
        id: user.id,
        email: user.email,
        username: user.username,
        is_admin: user.is_admin,
      },
      {
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        ua: request.headers.get("user-agent") ?? undefined,
      }
    );

    // Build response with cookies
    const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);
    const redirectTo = request.cookies.get("oauth_redirect")?.value ?? "/home";

    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    response.headers.append("Set-Cookie", "oauth_redirect=; Max-Age=0; Path=/; HttpOnly");

    return response;
  } catch (err) {
    console.error("[auth:telegram-callback] error", err);
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth_failed", request.url)
    );
  }
}
