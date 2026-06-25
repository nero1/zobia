export const dynamic = 'force-dynamic';

/**
 * app/api/auth/2fa/disable/route.ts
 *
 * POST /api/auth/2fa/disable
 *   Disable 2FA for the authenticated user.
 *   Requires the current TOTP code as confirmation.
 *   Body: { code: string }
 *   Returns: { success: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { decryptField } from "@/lib/security/fieldEncryption";
import { verifyTotp } from "@/lib/auth/totp";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const disableSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be exactly 6 digits"),
});

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/disable
// ---------------------------------------------------------------------------

/**
 * Disable 2FA for the authenticated user after verifying a current TOTP code.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", { ...RATE_LIMITS.apiWrite, limit: 10 });

    const { code } = await validateBody(req, disableSchema);
    const userId = auth.user.sub;

    // Fetch current TOTP secret
    const { rows: userRows } = await db.query<{ totp_secret: string | null; totp_enabled: boolean }>(
      "SELECT totp_secret, totp_enabled FROM users WHERE id = $1",
      [userId]
    );
    const row = userRows[0];

    if (!row || !row.totp_enabled || !row.totp_secret) {
      throw badRequest("2FA is not currently enabled", "TOTP_NOT_ENABLED");
    }

    // Decrypt the stored secret before TOTP verification (B-01)
    const plainSecret = decryptField(row.totp_secret);
    if (!plainSecret) {
      throw badRequest("2FA secret is invalid. Please contact support.", "TOTP_DECRYPT_FAILED");
    }

    if (!verifyTotp(plainSecret, code)) {
      throw badRequest("Invalid TOTP code", "TOTP_INVALID_CODE");
    }

    // Atomic anti-replay: SET NX ensures only one request can consume this code
    // within the 90-second TOTP window, even under concurrent requests (BUG-AUTH-03).
    const replayKey = `totp:used:${userId}:${code}`;
    const marked = await redis.set(replayKey, "1", "EX", 90, "NX");
    if (marked === null) {
      throw badRequest("TOTP code already used. Please wait for a new code.", "TOTP_REPLAY");
    }

    // Clear TOTP secret and disable
    await db.query(
      `UPDATE users SET totp_secret = NULL, totp_enabled = false, updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
