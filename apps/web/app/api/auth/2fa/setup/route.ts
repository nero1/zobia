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
import crypto from "crypto";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// TOTP helpers (manual HMAC-SHA1 implementation — no external library needed)
// ---------------------------------------------------------------------------

/**
 * Decode a Base32-encoded string to a Uint8Array.
 * Supports standard RFC 4648 Base32 alphabet (A-Z, 2-7).
 */
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

/**
 * Encode a buffer as Base32 (RFC 4648, no padding).
 */
function base32Encode(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Generate a TOTP code for the given Base32-encoded secret and counter (TOTP window).
 * Uses RFC 6238: HOTP with time step of 30 seconds.
 */
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

/**
 * Verify a 6-digit TOTP code against a secret.
 * Accepts a 1-window drift in both directions (±30 seconds).
 */
function verifyTOTP(secret: string, code: string): boolean {
  const timeStep = 30;
  const t = Math.floor(Date.now() / 1000 / timeStep);
  for (const drift of [-1, 0, 1]) {
    if (generateTOTP(secret, t + drift) === code) return true;
  }
  return false;
}

/**
 * Generate a random 20-byte Base32-encoded TOTP secret.
 */
function generateTOTPSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

// ---------------------------------------------------------------------------
// Redis key helper
// ---------------------------------------------------------------------------

const pendingTotpKey = (userId: string) => `totp:pending:${userId}`;

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

    const secret = generateTOTPSecret();
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

    const { code } = await validateBody(req, confirmSchema);
    const userId = auth.user.sub;

    const pendingSecret = await redis.get(pendingTotpKey(userId));
    if (!pendingSecret) {
      throw badRequest("No pending 2FA setup found. Please restart the setup process.", "TOTP_NO_PENDING");
    }

    if (!verifyTOTP(pendingSecret, code)) {
      throw badRequest("Invalid TOTP code. Please try again.", "TOTP_INVALID_CODE");
    }

    // Persist secret and enable TOTP
    await db.query(
      `UPDATE users SET totp_secret = $1, totp_enabled = true, updated_at = NOW()
       WHERE id = $2`,
      [pendingSecret, userId]
    );

    // Remove pending key
    await redis.del(pendingTotpKey(userId));

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
