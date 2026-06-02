/**
 * app/auth/callback/google/route.ts
 *
 * Google OAuth callback handler.
 *
 * Flow:
 *   1. Validate state (CSRF) from cookie
 *   2. Exchange code for tokens via Google
 *   3. Fetch Google user profile
 *   4. Upsert user in database (create if new, update last_login if existing)
 *   5. Create session (JWT + Redis)
 *   6. Set httpOnly cookies and redirect to app
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  exchangeGoogleCode,
  fetchGoogleUserProfile,
} from "@/lib/auth/google";
import { createSession, buildCookieHeaders } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** Simple username derivation from Google profile. */
function deriveUsername(email: string, name: string): string {
  const base = email.split("@")[0]?.replace(/[^a-z0-9_]/gi, "").toLowerCase() ?? "user";
  return base.slice(0, 20) || "user";
}

/**
 * GET /auth/callback/google
 * Handles the redirect from Google after the user grants consent.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  // User denied access
  if (errorParam) {
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth_failed", request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth_failed", request.url)
    );
  }

  // Validate CSRF state
  const cookieState = request.cookies.get("oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth_failed", request.url)
    );
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeGoogleCode(code);

    // Fetch profile
    const profile = await fetchGoogleUserProfile(tokens.access_token);

    // Upsert user in database
    const { rows } = await db.query<{
      id: string;
      email: string;
      username: string;
      is_admin: boolean;
      is_suspended: boolean;
    }>(
      `INSERT INTO users (email, google_id, display_name, avatar_url, email_verified, username, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         google_id = EXCLUDED.google_id,
         display_name = COALESCE(users.display_name, EXCLUDED.display_name),
         avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
         email_verified = TRUE,
         updated_at = NOW(),
         last_login_at = NOW()
       RETURNING id, email, username, is_admin, is_suspended`,
      [
        profile.email,
        profile.googleId,
        profile.name,
        profile.picture,
        profile.emailVerified,
        deriveUsername(profile.email, profile.name),
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
    const redirectTo = request.cookies.get("oauth_redirect")?.value ?? "/(app)/home";

    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    // Clear OAuth state cookies
    response.headers.append("Set-Cookie", "oauth_state=; Max-Age=0; Path=/; HttpOnly");
    response.headers.append("Set-Cookie", "oauth_redirect=; Max-Age=0; Path=/; HttpOnly");

    return response;
  } catch (err) {
    console.error("[auth:google-callback] error", err);
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth_failed", request.url)
    );
  }
}
