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
 * PRD §20: "mandatory 2FA (authenticator app). No Google OAuth for admin login."
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/middleware";

// ---------------------------------------------------------------------------
// TOTP helpers (minimal RFC 6238 implementation without heavy libraries)
// ---------------------------------------------------------------------------

/** Base32 alphabet. */
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode a Buffer to base32 string. */
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decode a base32 string to a Buffer. */
function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/**
 * Compute a TOTP code for the given secret at the given counter (30-second window).
 * Uses HMAC-SHA1 per RFC 4226/6238.
 */
async function computeTotp(secret: string, counter: number): Promise<string> {
  const { createHmac } = await import("crypto");
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  // Write counter as big-endian 64-bit
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  msg.writeUInt32BE(hi, 0);
  msg.writeUInt32BE(lo, 4);

  const hmac = createHmac("sha1", key);
  hmac.update(msg);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    (((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff)) %
    1_000_000;

  return code.toString().padStart(6, "0");
}

/** Verify a TOTP code within a ±1 window (30 seconds drift allowed). */
async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    const expected = await computeTotp(secret, counter + delta);
    if (expected === code) return true;
  }
  return false;
}

/** Generate a cryptographically random TOTP secret (20 bytes, base32-encoded). */
function generateTotpSecret(): string {
  const { randomBytes } = require("crypto") as typeof import("crypto");
  return base32Encode(randomBytes(20));
}

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
// GET — generate a fresh secret
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (_req: NextRequest, ctx: { params: Record<string, string>; auth: AdminContext }) => {
  try {
    const secret = generateTotpSecret();

    // Fetch admin email for the OTPAuth URI
    const { rows } = await db.query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1 LIMIT 1",
      [ctx.auth.user.sub]
    );
    const email = rows[0]?.email ?? "admin";
    const issuer = "Zobia";
    const otpauthUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    return NextResponse.json({ success: true, secret, otpauthUri, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST — verify and save the secret
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, ctx: { params: Record<string, string>; auth: AdminContext }) => {
  try {
    const body = await validateBody(req, setupSchema);

    const valid = await verifyTotp(body.secret, body.verificationCode);
    if (!valid) {
      throw badRequest("Invalid verification code. Please check the time on your device and try again.");
    }

    // Save the TOTP secret to the user record
    await db.query(
      `UPDATE users
       SET totp_secret = $1, totp_enabled = TRUE, updated_at = NOW()
       WHERE id = $2`,
      [body.secret, ctx.auth.user.sub]
    );

    return NextResponse.json({
      success: true,
      data: { message: "2FA has been activated for your admin account." },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
