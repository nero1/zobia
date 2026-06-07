/**
 * app/api/auth/2fa/verify/route.ts
 *
 * POST /api/auth/2fa/verify
 *   Called during login when totp_enabled=true.
 *   Body: { code: string, sessionToken: string }
 *   Verifies the TOTP code against the stored secret for the session user.
 *   Returns: { valid: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyAccessToken } from "@/lib/auth/jwt";

// ---------------------------------------------------------------------------
// TOTP helpers (same manual implementation as setup route)
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
  sessionToken: z.string().min(1, "Session token is required"),
});

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/verify
// ---------------------------------------------------------------------------

/**
 * Verify a TOTP code during login flow.
 * The sessionToken is the partially-authenticated access token issued after
 * credential verification but before 2FA completion.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", { ...RATE_LIMITS.apiWrite, limit: 10 });

    const { code, sessionToken } = await validateBody(req, verifySchema);

    // Decode the session token to get the user ID without full auth validation
    let userId: string;
    try {
      const payload = await verifyAccessToken(sessionToken);
      userId = payload.sub;
    } catch {
      throw unauthorized("Invalid session token");
    }

    // Fetch the user's stored TOTP secret
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
