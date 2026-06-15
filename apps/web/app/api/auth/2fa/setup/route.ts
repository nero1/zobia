export const dynamic = 'force-dynamic';

/**
 * app/api/auth/2fa/setup/route.ts
 *
 * GET /api/auth/2fa/setup
 *   Generate a TOTP secret for the current user.
 *   Stores the pending secret in Redis with a 10-minute TTL (not yet confirmed).
 *   Returns: { qrCodeUrl: string, secret: string }
 *
 * POST /api/auth/2fa/setup
 *   Confirm TOTP setup with a 6-digit code.
 *   Body: { code: string }
 *   Verifies the code against the pending Redis secret.
 *   On success, saves the secret to the users table and sets totp_enabled=true.
 *   Returns: { success: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getManifestValue } from "@/lib/manifest";
import { encryptField } from "@/lib/security/fieldEncryption";
import { verifyTotp, generateTotpSecret } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

const pendingTotpKey = (userId: string) => `totp:pending:${userId}`;
const usedTotpKey = (userId: string, code: string) => `totp:used:${userId}:${code}`;

// ---------------------------------------------------------------------------
// GET /api/auth/2fa/setup
// ---------------------------------------------------------------------------

/**
 * Generate a new TOTP secret and store it as pending in Redis (TTL: 10 min).
 * Returns the secret and a Google Authenticator-compatible otpauth:// URL.
 */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const twoFaKey = await getManifestValue("auth_2fa_enabled");
    if (twoFaKey === "false") {
      return NextResponse.json(
        { error: "Two-factor authentication is not enabled on this platform", code: "FEATURE_DISABLED" },
        { status: 403 }
      );
    }

    const secret = generateTotpSecret();
    const userId = auth.user.sub;

    // Fetch username for the QR code label
    const { rows: userRows } = await db.query<{ username: string }>(
      "SELECT username FROM users WHERE id = $1",
      [userId]
    );
    const username = userRows[0]?.username ?? userId;

    // Store pending secret in Redis for 10 minutes (600 seconds)
    await redis.set(pendingTotpKey(userId), secret, "EX", 600);

    const issuer = "Zobia";
    const label = encodeURIComponent(`${issuer}:${username}`);
    const qrCodeUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    return NextResponse.json({ qrCodeUrl, secret }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const confirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 digits"),
});

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/setup
// ---------------------------------------------------------------------------

/**
 * Confirm TOTP setup by verifying the supplied code against the pending secret.
 * On success, persists the secret and enables TOTP for the user.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const twoFaKeyPost = await getManifestValue("auth_2fa_enabled");
    if (twoFaKeyPost === "false") {
      return NextResponse.json(
        { error: "Two-factor authentication is not enabled on this platform", code: "FEATURE_DISABLED" },
        { status: 403 }
      );
    }

    const { code } = await validateBody(req, confirmSchema);
    const userId = auth.user.sub;

    // Replay protection: reject codes that were already used in the last 90s (S-04)
    const alreadyUsed = await redis.get(usedTotpKey(userId, code));
    if (alreadyUsed) {
      throw badRequest("TOTP code already used. Please wait for a new code.", "TOTP_REPLAY");
    }

    const pendingSecret = await redis.get(pendingTotpKey(userId));
    if (!pendingSecret) {
      throw badRequest("No pending 2FA setup found. Please restart the setup process.", "TOTP_NO_PENDING");
    }

    if (!verifyTotp(pendingSecret, code)) {
      throw badRequest("Invalid TOTP code. Please try again.", "TOTP_INVALID_CODE");
    }

    // Mark code as used to prevent replay (90s covers the TOTP window)
    await redis.set(usedTotpKey(userId, code), "1", "EX", 90);

    // Persist secret and enable TOTP
    await db.query(
      `UPDATE users SET totp_secret = $1, totp_enabled = true, updated_at = NOW()
       WHERE id = $2`,
      [encryptField(pendingSecret), userId]
    );

    // Remove pending key
    await redis.del(pendingTotpKey(userId));

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
