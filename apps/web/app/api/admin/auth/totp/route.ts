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
import { ADMIN_REFRESH_TOKEN_TTL_SECONDS } from "@/lib/auth/jwt";
import { decryptField } from "@/lib/security/fieldEncryption";
import { redis } from "@/lib/redis";
import { verifyTotp } from "@/lib/auth/totp";

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

    const secret = user.totp_secret ? decryptField(user.totp_secret) : null;
    if (!secret) {
      throw unauthorized("2FA secret not configured or corrupted. Please set up 2FA again.");
    }
    const totpValid = await verifyTotp(secret, body.code);
    if (!totpValid) {
      throw unauthorized("Invalid authenticator code. Check your device clock and try again.");
    }

    // Anti-replay: reject codes reused within the 90s TOTP window (BUG-12)
    const usedKey = `totp:used:${user.id}:${body.code}`;
    const alreadyUsed = await redis.set(usedKey, "1", "EX", 90, "NX");
    if (alreadyUsed === null) {
      throw unauthorized("TOTP code has already been used. Please wait for the next code.");
    }

    // Issue admin session (shorter TTL: 30 min access, 1 hour refresh)
    const tokens = await createSession(
      { id: user.id, email: user.email, username: user.username, is_admin: true },
      { ip, ua: req.headers.get("user-agent") ?? undefined, adminSession: true }
    );

    const { accessCookie, refreshCookie } = buildCookieHeaders(tokens, undefined, ADMIN_REFRESH_TOKEN_TTL_SECONDS);
    const response = NextResponse.json({ success: true }, { status: 200 });
    response.headers.append("Set-Cookie", accessCookie);
    response.headers.append("Set-Cookie", refreshCookie);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
