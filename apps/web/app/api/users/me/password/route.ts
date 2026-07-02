export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/password/route.ts
 *
 * PUT /api/users/me/password
 *
 * Change, set, or disable the authenticated user's password.
 *
 * - Requires current password verification only if the account already has
 *   one (`currentPassword` may be omitted/blank for accounts with no
 *   password set yet, or for accounts already updating a null hash).
 * - New password must be >= 8 characters.
 * - Omitting/blanking `newPassword` disables password login entirely — only
 *   allowed if the account has an alternative login method (Google or
 *   Telegram) linked, so the user can never lock themselves out.
 * - Bcrypt-hashed before storage.
 * - Returns 401 if current password is wrong.
 * - Rate limited: 5 attempts per hour per user.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const passwordChangeSchema = z.object({
  currentPassword: z.string().optional().nullable(),
  // Omitted/null/empty means "disable password" (see route doc above).
  newPassword: z
    .string()
    .max(128, "Password is too long")
    .refine((v) => v.length === 0 || v.length >= 8, {
      message: "Password must be at least 8 characters",
    })
    .optional()
    .nullable(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const { hash } = await import("bcryptjs");
  return hash(password, 12);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const { compare } = await import("bcryptjs");
  return compare(password, hash);
}

// ---------------------------------------------------------------------------
// PUT /api/users/me/password
// ---------------------------------------------------------------------------

export const PUT = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", {
      windowMs: 3600 * 1000,
      limit: 5,
      name: "password:change",
    });

    const body = await validateBody(req, passwordChangeSchema);
    const userId = auth.user.sub;

    const { rows } = await db.query<{
      password_hash: string | null;
      google_id: string | null;
      telegram_id: string | null;
    }>(
      `SELECT password_hash, google_id, telegram_id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    const user = rows[0];
    if (!user) throw unauthorized("User not found");

    const disabling = !body.newPassword;

    if (disabling) {
      // Nothing to disable.
      if (!user.password_hash) {
        return NextResponse.json({
          success: true,
          data: { message: "No password is set" },
          error: null,
        });
      }
      // Never let a user lock themselves out — require an alternative login.
      // Deliberately does NOT require currentPassword: "leave everything
      // blank to disable" is the whole point of the flow. The authenticated
      // session (plus the PIN gate on /settings, when the user has one set)
      // is the access control here, not the old password.
      if (!user.google_id && !user.telegram_id) {
        throw badRequest(
          "Link a Google or Telegram login before disabling your password, or you won't be able to sign in."
        );
      }
      await db.query(
        `UPDATE users SET password_hash = NULL, updated_at = NOW() WHERE id = $1`,
        [userId]
      );
      return NextResponse.json({
        success: true,
        data: { message: "Password disabled" },
        error: null,
      });
    }

    // If user already has a password, verify the current one before setting a new one.
    if (user.password_hash) {
      if (!body.currentPassword) {
        throw badRequest("Current password is required to change your password");
      }
      const isValid = await verifyPassword(body.currentPassword, user.password_hash);
      if (!isValid) {
        throw unauthorized("Current password is incorrect");
      }
    }

    // Hash and store the new password
    const newHash = await hashPassword(body.newPassword as string);

    await db.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, userId]
    );

    return NextResponse.json({
      success: true,
      data: { message: "Password updated successfully" },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
