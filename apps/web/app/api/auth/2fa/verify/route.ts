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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { redis } from "@/lib/redis";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, unauthorized, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, getUserAgent, RATE_LIMITS } from "@/lib/security/rateLimit";
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
    const ua = getUserAgent(req);
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
      const orm = await getDb();
      const [user] = await orm
        .select({
          id: schema.users.id,
          email: schema.users.email,
          username: schema.users.username,
          isAdmin: schema.users.isAdmin,
          totpSecret: schema.users.totpSecret,
          totpEnabled: schema.users.totpEnabled,
          onboardingCompleted: schema.users.onboardingCompleted,
          isModerator: schema.users.isModerator,
          avatarEmoji: schema.users.avatarEmoji,
          city: schema.users.city,
          xpTotal: schema.users.xpTotal,
          rankName: schema.users.rankName,
          isCreator: schema.users.isCreator,
          plan: schema.users.plan,
          isBanned: schema.users.isBanned,
          isSuspended: schema.users.isSuspended,
          suspendedUntil: schema.users.suspendedUntil,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!user || !user.totpEnabled || !user.totpSecret) {
        throw badRequest("2FA is not enabled for this user", "TOTP_NOT_ENABLED");
      }

      if (user.isBanned) {
        throw forbidden("Your account has been banned.");
      }

      if (user.isSuspended && user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
        throw forbidden("Your account is currently suspended.");
      }

      const secret = user.totpSecret ? decryptField(user.totpSecret) : null;
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
      await orm
        .update(schema.users)
        .set({ preAuthSession: null, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));

      // Create full session
      const authTokens = await createSession(
        {
          id: user.id,
          email: user.email,
          username: user.username ?? "",
          is_admin: user.isAdmin,
          is_moderator: user.isModerator,
          is_creator: user.isCreator,
        },
        { ip, ua }
      );

      if (isMobile) {
        // Mobile clients cannot receive HttpOnly cookies — return tokens in the
        // response body so the Expo app can store them in SecureStore.
        // BUG-EXPO-03: include all AuthUser fields so the mobile app has full user state.
        return NextResponse.json({
          success: true,
          onboardingCompleted: user.onboardingCompleted,
          accessToken: authTokens.accessToken,
          refreshToken: authTokens.refreshToken,
          userId: user.id,
          user: {
            id: user.id,
            username: user.username ?? "",
            avatarEmoji: user.avatarEmoji ?? "😎",
            city: user.city ?? "",
            xp: user.xpTotal != null ? Number(user.xpTotal) : 0,
            rankTier: user.rankName ?? "Beginner",
            plan: (user.plan ?? "free") as "free" | "plus" | "pro" | "max",
            isAdmin: user.isAdmin,
            isModerator: user.isModerator,
            isCreator: user.isCreator,
            onboardingCompleted: user.onboardingCompleted,
          },
        });
      }

      const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);
      const response = NextResponse.json({
        success: true,
        onboardingCompleted: user.onboardingCompleted,
      });
      response.headers.append("Set-Cookie", accessCookie);
      response.headers.append("Set-Cookie", refreshCookie);
      return response;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
