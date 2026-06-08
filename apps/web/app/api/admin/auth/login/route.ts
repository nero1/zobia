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
import { z } from "zod";
import { db } from "@/lib/db";
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
    const { compare } = await import("bcryptjs");
    const passwordHash = user?.password_hash ?? "$2b$12$invalidhashfortimingatack000000000";
    const passwordValid = await compare(body.password, passwordHash);

    if (!user || !passwordValid || !user.is_admin || user.deleted_at) {
      throw unauthorized("Invalid credentials");
    }

    // Check if admin has completed TOTP setup
    if (!user.totp_enabled || !user.totp_secret) {
      return NextResponse.json({ success: true, needsSetup: true }, { status: 200 });
    }

    return NextResponse.json({ success: true, needsSetup: false }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
