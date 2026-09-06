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
import { compare, hash } from "bcryptjs"; // BUG-PERF-03: static import avoids per-request module resolution
import { z } from "zod";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { handleApiError, unauthorized, badRequest, ApiError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/middleware";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isAdminLockedOut, recordAdminLoginFailure } from "@/lib/auth/adminLockout";
import { isCaptchaSurfaceEnabled, verifyCaptcha } from "@/lib/security/captcha";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
  captchaToken: z.string().max(4000).optional(),
});

// Module-level dummy hash (async) for constant-time comparison when user is not found.
// Using hash() (async) avoids blocking the Node.js event loop on cold start.
// A valid 60-char bcrypt hash prevents timing attacks that would otherwise
// reveal whether an email address exists in the database.
const DUMMY_HASH_PROMISE = hash("timing-equalization-sentinel", 12);

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

    // CAPTCHA — per-surface admin toggle (independent of the public login form's).
    if (await isCaptchaSurfaceEnabled("admin_login")) {
      if (!body.captchaToken || !(await verifyCaptcha(body.captchaToken, ip, "admin_login"))) {
        throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
      }
    }

    // Anti-brute-force: reject before touching the DB/bcrypt if this email is
    // already locked out from 3 prior failed attempts (see lib/auth/adminLockout.ts).
    if (await isAdminLockedOut(body.email)) {
      throw new ApiError(
        423,
        "ADMIN_LOCKED",
        "This account is locked after too many failed attempts. Enter your Secret Magic Word to unlock it."
      );
    }

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
    const passwordHash = user?.password_hash ?? (await DUMMY_HASH_PROMISE);
    const passwordValid = await compare(body.password, passwordHash);

    if (!user || !passwordValid || !user.is_admin || user.deleted_at) {
      // Only count failures against real admin emails toward the lockout —
      // still runs bcrypt above either way so timing doesn't leak which case this is.
      if (user?.is_admin) {
        const { locked } = await recordAdminLoginFailure(body.email);
        if (locked) {
          throw new ApiError(
            423,
            "ADMIN_LOCKED",
            "This account is now locked after too many failed attempts. Enter your Secret Magic Word to unlock it."
          );
        }
      }
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
