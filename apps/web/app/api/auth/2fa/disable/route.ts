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
import crypto from "crypto";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// TOTP helpers (same manual implementation as setup/verify routes)
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

    if (!verifyTOTP(row.totp_secret, code)) {
      throw badRequest("Invalid TOTP code", "TOTP_INVALID_CODE");
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
