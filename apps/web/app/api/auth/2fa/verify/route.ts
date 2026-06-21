export const dynamic = 'force-dynamic';

/**
 * app/api/auth/2fa/verify/route.ts
 *
 * POST /api/auth/2fa/verify
 *   Called during login when totp_enabled=true.
 *
 *   Accepts: { code, preAuthToken } — pre-auth flow: verifies TOTP code, creates full session.
 *
 *   On success (web): sets session cookies and returns { success: true }.
 *   On success (mobile ?platform=mobile): returns tokens + full user object in body.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { createSession, buildCookieHeaders } from "@/lib/auth/session";
import { decryptField } from "@/lib/security/fieldEncryption";
import { verifyTotp } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 digits"),
  preAuthToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/verify
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", { ...RATE_LIMITS.apiWrite, limit: 10 });

    // Mobile callers (Expo app) cannot receive cookies; they need tokens in the
    // response body. Detected via ?platform=mobile query param.
    const isMobile = req.nextUrl.searchParams.get("platform") === "mobile";

    const { code, preAuthToken } = await validateBody(req, verifySchema);

    // Also rate-limit by userId to prevent credential stuffing across IPs
    {
      let preAuthUserId: string | null = null;
      try {
        const payload = await verifyAccessToken(preAuthToken);
        preAuthUserId = payload.sub ?? null;
      } catch {
        // ignore — invalid token error is handled below
      }
      if (preAuthUserId) {
        await enforceRateLimit(preAuthUserId, "user", { windowMs: 900 * 1000, limit: 5, name: "2fa:verify" });
      }
    }

    // -----------------------------------------------------------------------
    // Pre-auth flow: preAuthToken issued during OAuth callback
    // -----------------------------------------------------------------------
    {
      let userId: string;
      try {
        const payload = await verifyAccessToken(preAuthToken);
        if ((payload as Record<string, unknown>).type !== "pre_auth") {
          throw new Error("Not a pre-auth token");
        }
        userId = payload.sub;
      } catch {
        throw unauthorized("Invalid or expired pre-auth token");
      }

      // Confirm the pre-auth key still exists in Redis
      const redisKey = `pre_auth:${userId}`;
      const storedToken = await redis.get(redisKey);
      if (!storedToken || storedToken !== preAuthToken) {
        throw unauthorized("Pre-auth token has expired or already been used");
      }

      // Fetch user row
      const { rows } = await db.query<{
        id: string;
        email: string;
        username: string;
        is_admin: boolean;
        totp_secret: string | null;
        totp_enabled: boolean;
        onboarding_completed: boolean;
        is_moderator: boolean;
        avatar_emoji: string | null;
        city: string | null;
        xp_total: number | null;
        rank_name: string | null;
        is_creator: boolean;
        plan: string | null;
      }>(
        `SELECT id, email, username, is_admin, totp_secret, totp_enabled, onboarding_completed, is_moderator,
                avatar_emoji, city, xp_total, rank_name, COALESCE(is_creator, false) AS is_creator, plan
         FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      const user = rows[0];

      if (!user || !user.totp_enabled || !user.totp_secret) {
        throw badRequest("2FA is not enabled for this user", "TOTP_NOT_ENABLED");
      }

      const secret = user.totp_secret ? decryptField(user.totp_secret) : null;
      if (!secret || !(await verifyTotp(secret, code))) {
        return NextResponse.json({ success: false, error: "Invalid code" }, { status: 400 });
      }

      // Anti-replay: reject codes reused within the 90s TOTP window (BUG-12)
      const usedKey = `totp:used:${userId}:${code}`;
      const alreadyUsed = await redis.set(usedKey, "1", "EX", 90, "NX");
      if (alreadyUsed === null) {
        return NextResponse.json({ success: false, error: "TOTP code already used" }, { status: 400 });
      }

      // Consume the pre-auth token — clear both Redis key and DB column
      await redis.del(redisKey);
      await db.query(
        `UPDATE users SET pre_auth_session = NULL, updated_at = NOW() WHERE id = $1`,
        [userId]
      );

      // Create full session
      const authTokens = await createSession(
        {
          id: user.id,
          email: user.email,
          username: user.username ?? "",
          is_admin: user.is_admin,
          is_moderator: user.is_moderator,
          is_creator: user.is_creator,
        },
        { ip }
      );

      if (isMobile) {
        // Mobile clients cannot receive HttpOnly cookies — return tokens in the
        // response body so the Expo app can store them in SecureStore.
        // BUG-EXPO-03: include all AuthUser fields so the mobile app has full user state.
        return NextResponse.json({
          success: true,
          onboardingCompleted: user.onboarding_completed,
          accessToken: authTokens.accessToken,
          refreshToken: authTokens.refreshToken,
          userId: user.id,
          user: {
            id: user.id,
            username: user.username ?? "",
            avatarEmoji: user.avatar_emoji ?? "😎",
            city: user.city ?? "",
            xp: user.xp_total ?? 0,
            rankTier: user.rank_name ?? "Beginner",
            plan: (user.plan ?? "free") as "free" | "plus" | "pro" | "max",
            isAdmin: user.is_admin,
            isModerator: user.is_moderator,
            isCreator: user.is_creator,
            onboardingCompleted: user.onboarding_completed,
          },
        });
      }

      const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);
      const response = NextResponse.json({
        success: true,
        onboardingCompleted: user.onboarding_completed,
      });
      response.headers.append("Set-Cookie", accessCookie);
      response.headers.append("Set-Cookie", refreshCookie);
      return response;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
