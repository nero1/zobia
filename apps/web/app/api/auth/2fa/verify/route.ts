export const dynamic = 'force-dynamic';

/**
 * app/api/auth/2fa/verify/route.ts
 *
 * POST /api/auth/2fa/verify
 *   Called during login when totp_enabled=true.
 *
 *   Accepts either:
 *   a) { code, preAuthToken } — pre-auth flow: verifies code, creates full session
 *   b) { code, sessionToken } — legacy: verifies code against an existing session token
 *
 *   On success with preAuthToken: sets session cookies and returns { success: true }.
 *   On success with sessionToken: returns { valid: true }.
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

    const { code, preAuthToken } = await validateBody(req, verifySchema);

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
      }>(
        `SELECT id, email, username, is_admin, totp_secret, totp_enabled, onboarding_completed, is_moderator
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

      // Consume the pre-auth token
      await redis.del(redisKey);

      // Create full session
      const authTokens = await createSession(
        { id: user.id, email: user.email, username: user.username ?? "", is_admin: user.is_admin },
        { ip }
      );

      const { accessCookie, refreshCookie } = buildCookieHeaders(authTokens);
      const response = NextResponse.json({
        success: true,
        onboardingCompleted: user.onboarding_completed,
      });
      response.headers.append("Set-Cookie", accessCookie);
      response.headers.append("Set-Cookie", refreshCookie);
      return response;
    }

    throw badRequest("preAuthToken is required", "MISSING_TOKEN");
  } catch (err) {
    return handleApiError(err);
  }
}
