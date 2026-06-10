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
import crypto from "crypto";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { createSession, buildCookieHeaders } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// TOTP helpers
// ---------------------------------------------------------------------------

function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = input.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of str) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function generateTOTP(secret: string, counter?: number): string {
  const timeStep = 30;
  const t = counter ?? Math.floor(Date.now() / 1000 / timeStep);
  const buf = Buffer.alloc(8);
  let tmp = t;
  for (let i = 7; i >= 0; i--) {
    buf[i] = tmp & 0xff;
    tmp >>= 8;
  }
  const key = Buffer.from(base32Decode(secret));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function verifyTOTP(secret: string, code: string): boolean {
  const timeStep = 30;
  const t = Math.floor(Date.now() / 1000 / timeStep);
  for (const drift of [-1, 0, 1]) {
    if (generateTOTP(secret, t + drift) === code) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 digits"),
  preAuthToken: z.string().optional(),
  sessionToken: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/verify
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", { ...RATE_LIMITS.apiWrite, limit: 10 });

    const { code, preAuthToken, sessionToken } = await validateBody(req, verifySchema);

    if (!preAuthToken && !sessionToken) {
      throw badRequest("Either preAuthToken or sessionToken is required", "MISSING_TOKEN");
    }

    // -----------------------------------------------------------------------
    // Pre-auth flow: preAuthToken issued during OAuth callback
    // -----------------------------------------------------------------------
    if (preAuthToken) {
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

      if (!verifyTOTP(user.totp_secret, code)) {
        return NextResponse.json({ success: false, error: "Invalid code" }, { status: 400 });
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
        accessToken: authTokens.accessToken,
        refreshToken: authTokens.refreshToken,
      });
      response.headers.append("Set-Cookie", accessCookie);
      response.headers.append("Set-Cookie", refreshCookie);
      return response;
    }

    // -----------------------------------------------------------------------
    // Legacy flow: sessionToken (existing access token)
    // -----------------------------------------------------------------------
    let userId: string;
    try {
      const payload = await verifyAccessToken(sessionToken!);
      userId = payload.sub;
    } catch {
      throw unauthorized("Invalid session token");
    }

    const { rows: userRows } = await db.query<{ totp_secret: string | null; totp_enabled: boolean }>(
      "SELECT totp_secret, totp_enabled FROM users WHERE id = $1",
      [userId]
    );
    const row = userRows[0];

    if (!row || !row.totp_enabled || !row.totp_secret) {
      throw badRequest("2FA is not enabled for this user", "TOTP_NOT_ENABLED");
    }

    const valid = verifyTOTP(row.totp_secret, code);
    return NextResponse.json({ valid }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
