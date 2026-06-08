export const dynamic = 'force-dynamic';

/**
 * app/api/admin/auth/totp/route.ts
 *
 * POST /api/admin/auth/totp
 *
 * Step 2 of the admin 2FA login flow.
 *
 * Re-verifies email + password AND the TOTP code in a single request,
 * then issues a session (access + refresh cookies) if both are valid.
 *
 * By re-verifying credentials here, the two-step flow remains stateless:
 * no temporary token is needed between the credentials and TOTP steps.
 *
 * PRD §20: "mandatory 2FA (authenticator app). No Google OAuth for admin login."
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApiError, unauthorized } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/middleware";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { createSession, buildCookieHeaders } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// TOTP helpers (mirrors the implementation in totp/setup/route.ts)
// ---------------------------------------------------------------------------

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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

async function computeTotp(secret: string, counter: number): Promise<string> {
  const { createHmac } = await import("crypto");
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
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

async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    if ((await computeTotp(secret, counter + delta)) === code) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const totpLoginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

// ---------------------------------------------------------------------------
// DB row
// ---------------------------------------------------------------------------

interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  is_admin: boolean;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const body = await validateBody(req, totpLoginSchema);

    const { rows } = await db.query<AdminUserRow>(
      `SELECT id, email, username, password_hash, totp_secret, totp_enabled,
              is_admin, deleted_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [body.email.toLowerCase()]
    );

    const user = rows[0];

    // Always run bcrypt to prevent timing attacks
    const { compare } = await import("bcryptjs");
    const hash = user?.password_hash ?? "$2b$12$invalidhashfortimingattack0000000";
    const passwordValid = await compare(body.password, hash);

    if (!user || !passwordValid || !user.is_admin || user.deleted_at) {
      throw unauthorized("Invalid credentials");
    }

    if (!user.totp_enabled || !user.totp_secret) {
      throw unauthorized("2FA is not configured for this account. Please set it up first.");
    }

    const totpValid = await verifyTotp(user.totp_secret, body.code);
    if (!totpValid) {
      throw unauthorized("Invalid authenticator code. Check your device clock and try again.");
    }

    // Issue session
    const tokens = await createSession(
      { id: user.id, email: user.email, username: user.username, is_admin: true },
      { ip, ua: req.headers.get("user-agent") ?? undefined }
    );

    const { accessCookie, refreshCookie } = buildCookieHeaders(tokens);
    const response = NextResponse.json({ success: true }, { status: 200 });
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
