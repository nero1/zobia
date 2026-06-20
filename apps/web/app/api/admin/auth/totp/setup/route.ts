export const dynamic = 'force-dynamic';

/**
 * app/api/admin/auth/totp/setup/route.ts
 *
 * Admin TOTP 2FA Setup
 *
 * GET  /api/admin/auth/totp/setup
 *   Generates a fresh TOTP secret for the currently-authenticated admin.
 *   Returns: { secret, otpauthUri }
 *
 * POST /api/admin/auth/totp/setup
 *   Verifies the provided code against the secret, then saves the secret
 *   to the admin's user record.
 *   Body: { secret, verificationCode }
 *
 * Auth: Accepts either:
 *   1. X-Admin-Pre-Auth header — a one-time setup token issued by /api/admin/auth/login
 *      when needsSetup: true. This allows first-time TOTP setup without a session.
 *   2. A valid admin JWT (for re-setup after 2FA is already configured).
 *
 * PRD §20: "mandatory 2FA (authenticator app). No Google OAuth for admin login."
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, unauthorized } from "@/lib/api/errors";
import { encryptField } from "@/lib/security/fieldEncryption";
import { generateTotpSecret, verifyTotp } from "@/lib/auth/totp";
import { redis } from "@/lib/redis";
import { ACCESS_TOKEN_COOKIE, getSession } from "@/lib/auth/session";
import { verifyAccessToken } from "@/lib/auth/jwt";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const setupSchema = z.object({
  secret: z.string().min(16, "Secret too short"),
  verificationCode: z
    .string()
    .regex(/^\d{6}$/, "Verification code must be 6 digits"),
});

// ---------------------------------------------------------------------------
// Dual-auth resolver — pre-auth token first, then admin JWT fallback
// ---------------------------------------------------------------------------

async function resolveAdminUserId(req: NextRequest): Promise<string> {
  // 1. Check for pre-auth setup token stored in HttpOnly cookie (issued by /api/admin/auth/login when needsSetup: true)
  const preAuthToken = req.cookies.get("admin_setup_token")?.value;
  if (preAuthToken) {
    const userId = await redis.getdel(`admin_pre_auth:setup:${preAuthToken}`);
    if (userId) return userId;
    throw unauthorized("Invalid or expired setup token");
  }

  // 2. Fall back to admin JWT verification
  const accessToken =
    req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) throw unauthorized("Authentication required");

  const payload = await verifyAccessToken(accessToken);
  const session = await getSession(payload.sid!);
  if (!session || !session.is_admin) throw unauthorized("Admin access required");

  return payload.sub as string;
}

// ---------------------------------------------------------------------------
// GET — generate a fresh secret
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const adminId = await resolveAdminUserId(req);

    const secret = generateTotpSecret();

    const { rows } = await db.query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1 LIMIT 1",
      [adminId]
    );
    const email = rows[0]?.email ?? "admin";
    const issuer = "Zobia";
    const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    return NextResponse.json({ success: true, secret, otpauthUri, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST — verify and save the secret
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const adminId = await resolveAdminUserId(req);
    const body = await validateBody(req, setupSchema);

    const valid = await verifyTotp(body.secret, body.verificationCode);
    if (!valid) {
      throw badRequest("Invalid verification code. Please check the time on your device and try again.");
    }

    // Anti-replay: reject codes reused within the 90s TOTP window
    const usedKey = `totp:used:${adminId}:${body.verificationCode}`;
    const alreadyUsed = await redis.set(usedKey, "1", "EX", 90, "NX");
    if (alreadyUsed === null) {
      throw badRequest("TOTP code has already been used. Please wait for the next code.");
    }

    await db.query(
      `UPDATE users
       SET totp_secret = $1, totp_enabled = TRUE, updated_at = NOW()
       WHERE id = $2`,
      [encryptField(body.secret), adminId]
    );

    return NextResponse.json({
      success: true,
      data: { message: "2FA has been activated for your admin account." },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
