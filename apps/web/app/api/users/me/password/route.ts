/**
 * app/api/users/me/password/route.ts
 *
 * PUT /api/users/me/password
 *
 * Change the authenticated user's password.
 *
 * - Requires current password verification (or Google-only accounts can set one)
 * - New password must be >= 8 characters
 * - Bcrypt-hashed before storage
 * - Returns 401 if current password is wrong
 * - Rate limited: 5 attempts per hour per user
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
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
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

export const PUT = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", {
      windowMs: 3600 * 1000,
      limit: 5,
      name: "password:change",
    });

    const body = await validateBody(req, passwordChangeSchema);
    const userId = auth.user.sub;

    const { rows } = await db.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    const user = rows[0];
    if (!user) throw unauthorized("User not found");

    // If user already has a password, verify the current one
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
    const newHash = await hashPassword(body.newPassword);

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
