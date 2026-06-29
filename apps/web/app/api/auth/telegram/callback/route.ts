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
 *   5a. Web:    Sets HttpOnly cookies and redirects to /home or /onboarding
 *   5b. Mobile: Creates one-time exchange code, redirects to deep link
 *
 * Mobile flow:
 *   Pass ?mobile_redirect=zobia://auth/callback (or in the data-auth-url from
 *   the telegram-mobile widget page).  After successful auth the handler creates
 *   an exchange code in Redis (90 s TTL, single-use) and redirects to
 *   mobile_redirect?code=EXCHANGE_CODE.  The Capacitor app exchanges the code
 *   at POST /api/auth/mobile-token to receive tokens without exposing them
 *   in a URL.
 *
 * Reference: https://core.telegram.org/widgets/login#checking-authorization
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  verifyTelegramLogin,
  parseTelegramParams,
} from "@/lib/auth/telegram";
import { createSession, buildCookieHeaders } from "@/lib/auth/session";
import { signAccessToken } from "@/lib/auth/jwt";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { handleApiError, badRequest, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getManifestValue } from "@/lib/manifest";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Allowed mobile redirect schemes (mirrors Google callback — ZB-01)
// ---------------------------------------------------------------------------

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

interface UserRow {
  id: string;
  email: string;
  username: string;
  is_admin: boolean;
  is_moderator: boolean;
  is_banned: boolean;
  is_suspended: boolean;
  totp_enabled: boolean;
  onboarding_completed: boolean;
  display_name: string | null;
  avatar_emoji: string | null;
  city: string | null;
  xp_total: number;
  rank_name: string | null;
  plan: string | null;
  is_creator: boolean;
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
    `SELECT id, email, username, is_admin, is_moderator, is_banned, is_suspended,
            totp_enabled, onboarding_completed, display_name, avatar_emoji, city,
            xp_total, rank_name, plan, is_creator
     FROM users
     WHERE telegram_id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [profile.telegramId]
  );

  if (existing.rows[0]) {
    const u = existing.rows[0];
    if (u.is_banned) throw Object.assign(new Error("Account is banned"), { code: "ACCOUNT_BANNED" });
    if (u.is_suspended) throw Object.assign(new Error("Account is suspended"), { code: "ACCOUNT_SUSPENDED" });
    return u;
  }

  // Build display name from Telegram profile
  const displayName = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(" ");

  // Create new user
  const inserted = await db.query<UserRow>(
    `INSERT INTO users (
       telegram_id, display_name, avatar_url, onboarding_completed,
       is_admin, is_creator, created_at, updated_at
     )
     VALUES ($1, $2, $3, false, false, false, NOW(), NOW())
     RETURNING id, email, username, is_admin, is_moderator, is_banned, is_suspended,
               totp_enabled, onboarding_completed, display_name, avatar_emoji, city,
               xp_total, rank_name, plan, is_creator`,
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
 * issues a platform JWT, and either sets HttpOnly cookies (web) or
 * creates an exchange code and redirects to the mobile deep link.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const { searchParams } = new URL(req.url);

    // Read optional mobile redirect — passed as a query param from the
    // telegram-mobile widget page (e.g. data-auth-url includes it).
    const mobileRedirectParam = searchParams.get("mobile_redirect");
    const mobileRedirect = mobileRedirectParam && isRedirectAllowed(mobileRedirectParam)
      ? mobileRedirectParam
      : null;

    // Parse Telegram login params from query string (ignores mobile_redirect)
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

    const reqOrigin = env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

    // 2FA gate
    const [twoFaRaw, twoFaModsRaw] = await Promise.all([
      getManifestValue("auth_2fa_enabled"),
      getManifestValue("auth_2fa_required_for_mods"),
    ]);
    const twoFaGloballyEnabled = twoFaRaw !== "false"; // default enabled
    const twoFaRequiredForMods = twoFaModsRaw === "true"; // default disabled

    const needsTwoFaVerify = twoFaGloballyEnabled && user.totp_enabled;
    const mustSetUp2Fa = twoFaRequiredForMods && user.is_moderator && !user.totp_enabled;

    if (mustSetUp2Fa) {
      if (mobileRedirect) {
        // Redirect back to login with error; 2FA setup not supported on mobile yet
        const deepLink = new URL(mobileRedirect);
        deepLink.searchParams.set("error", "2fa_required");
        return NextResponse.redirect(deepLink.toString(), { status: 302 });
      }
      return NextResponse.redirect(new URL("/auth/require-2fa", reqOrigin), { status: 302 });
    }

    if (needsTwoFaVerify) {
      const preAuthToken = await signAccessToken(
        {
          sub: user.id,
          email: user.email ?? "",
          username: user.username ?? "",
          is_admin: user.is_admin,
          sid: "pre_auth",
          type: "pre_auth",
        } as Parameters<typeof signAccessToken>[0],
        5 * 60
      );
      await redis.setex(`pre_auth:${user.id}`, 5 * 60, preAuthToken);

      if (mobileRedirect) {
        const preAuthCode = crypto.randomBytes(32).toString("hex");
        await redis.setex(`mobile_pre_auth:${preAuthCode}`, 300, preAuthToken);
        const deepLink = new URL(mobileRedirect);
        deepLink.searchParams.set("pre_auth_code", preAuthCode);
        deepLink.searchParams.set("requires_2fa", "true");
        return NextResponse.redirect(deepLink.toString(), { status: 302 });
      }

      const dest = new URL("/auth/2fa", reqOrigin);
      const webPreAuthCode = crypto.randomBytes(32).toString("hex");
      await redis.setex(`web_pre_auth:${webPreAuthCode}`, 300, preAuthToken);
      dest.searchParams.set("code", webPreAuthCode);
      return NextResponse.redirect(dest, { status: 302 });
    }

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

    // -----------------------------------------------------------------
    // Mobile flow: exchange code deep-link (same pattern as Google)
    // -----------------------------------------------------------------
    if (mobileRedirect) {
      const exchangeCode = crypto.randomBytes(32).toString("hex");
      const authUser = {
        id: user.id,
        username: user.username ?? profile.username ?? "",
        displayName: user.display_name ?? user.username ?? profile.firstName,
        avatarEmoji: user.avatar_emoji ?? "😎",
        city: user.city ?? "",
        xp: user.xp_total ?? 0,
        rankTier: user.rank_name ?? "Beginner",
        plan: (user.plan ?? "free") as "free" | "plus" | "pro" | "max",
        isAdmin: user.is_admin,
        isModerator: user.is_moderator,
        isCreator: user.is_creator,
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
      return NextResponse.redirect(deepLink.toString(), { status: 302 });
    }

    // -----------------------------------------------------------------
    // Web flow: set HttpOnly cookies and redirect to home / onboarding
    // -----------------------------------------------------------------
    const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);

    const destination = user.onboarding_completed
      ? new URL("/home", reqOrigin)
      : new URL("/onboarding", reqOrigin);

    const response = NextResponse.redirect(destination, { status: 302 });
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    return response;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ACCOUNT_BANNED" || code === "ACCOUNT_SUSPENDED") {
      const reqOrigin = env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
      return NextResponse.redirect(
        new URL(`/auth/login?error=${code.toLowerCase()}`, reqOrigin),
        { status: 302 }
      );
    }
    return handleApiError(err);
  }
}
