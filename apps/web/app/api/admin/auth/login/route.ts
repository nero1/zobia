export const dynamic = 'force-dynamic';

/**
 * app/api/admin/auth/login/route.ts
 *
 * POST /api/admin/auth/login
 *
 * Step 1 of the admin 2FA login flow.
 *
 * Verifies email + password. Returns:
 *   { needsSetup: true }   if the admin has not yet configured TOTP
 *   { success: true }      if credentials are valid and TOTP is configured
 *                          (client then calls /api/admin/auth/totp)
 *
 * No session is issued at this step — the full session is issued only after
 * both credentials AND the TOTP code have been verified.
 *
 * PRD §20: "mandatory 2FA (authenticator app). No Google OAuth for admin login."
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { compare, hashSync } from "bcryptjs"; // BUG-PERF-03: static import avoids per-request module resolution
import { z } from "zod";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { handleApiError, unauthorized } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/middleware";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});

// Module-level dummy hash for constant-time comparison when user is not found.
// A valid 60-char bcrypt hash prevents timing attacks that would otherwise
// reveal whether an email address exists in the database.
const DUMMY_HASH = hashSync("timing-equalization-sentinel", 12);

// ---------------------------------------------------------------------------
// DB row
// ---------------------------------------------------------------------------

interface AdminUserRow {
  id: string;
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
    // Rate limit by IP to prevent brute-force
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const body = await validateBody(req, loginSchema);

    // Look up admin by email
    const { rows } = await db.query<AdminUserRow>(
      `SELECT id, password_hash, totp_secret, totp_enabled, is_admin, deleted_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [body.email.toLowerCase()]
    );

    const user = rows[0];

    // Constant-time failure path: always run bcrypt compare to prevent timing attacks
    const passwordHash = user?.password_hash ?? DUMMY_HASH;
    const passwordValid = await compare(body.password, passwordHash);

    if (!user || !passwordValid || !user.is_admin || user.deleted_at) {
      throw unauthorized("Invalid credentials");
    }

    // Check if admin has completed TOTP setup
    if (!user.totp_enabled || !user.totp_secret) {
      // Issue a one-time pre-auth setup token so the client can access the TOTP
      // setup endpoint without a full session. The token is stored in Redis with
      // a 5-minute TTL and consumed (GETDEL) by the setup endpoint.
      const setupToken = randomBytes(32).toString("hex");
      await redis.setex(`admin_pre_auth:setup:${setupToken}`, 300, user.id);
      // Store token in HttpOnly cookie — not in the JSON body which is XSS-readable.
      const resp = NextResponse.json({ success: true, needsSetup: true }, { status: 200 });
      resp.headers.set(
        "Set-Cookie",
        `admin_setup_token=${setupToken}; HttpOnly; SameSite=Strict; Path=/api/admin/auth/totp/setup; Max-Age=300`
      );
      return resp;
    }

    return NextResponse.json({ success: true, needsSetup: false }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
