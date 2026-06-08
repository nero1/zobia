export const dynamic = 'force-dynamic';

/**
 * app/api/auth/password-reset/route.ts
 *
 * Password reset flow per PRD §4 (Account Recovery).
 *
 * POST /api/auth/password-reset       – Request a password reset email
 * PATCH /api/auth/password-reset      – Complete reset with token + new password
 *
 * Flow:
 *   1. User submits email address
 *   2. If found, generate a one-time secure token (SHA-256 hashed in DB)
 *   3. Send reset email with link: <APP_URL>/auth/reset-password?token=<raw>
 *   4. Token expires after 1 hour
 *   5. User submits token + new password via PATCH
 *   6. Verify token, set new password, invalidate token
 *
 * Security:
 *   - Always returns 200 even if email not found (prevents email enumeration)
 *   - Token is stored as SHA-256 hash; raw token only ever in email
 *   - Rate limited: 3 requests per hour per IP
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes, createHash } from "crypto";
import { db } from "@/lib/db";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const requestResetSchema = z.object({
  email: z.string().email("Must be a valid email address"),
});

const completeResetSchema = z.object({
  token: z.string().min(32, "Invalid reset token"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function sendResetEmail(
  email: string,
  displayName: string,
  rawToken: string
): Promise<void> {
  const { sendEmail } = await import("@/lib/notifications/email");
  const resetUrl = `${env.NEXT_PUBLIC_APP_URL}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;

  await sendEmail(
    email,
    "Reset your Zobia password",
    `Hi ${displayName}, click the link to reset your password: ${resetUrl} (expires in 1 hour)`,
    `<p>Hi ${displayName},</p>
     <p>Someone (probably you) requested a password reset for your Zobia account.</p>
     <p><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Reset Password</a></p>
     <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`
  );
}

// ---------------------------------------------------------------------------
// POST /api/auth/password-reset  — Request reset
// ---------------------------------------------------------------------------

export const POST = async (req: NextRequest) => {
  try {
    const ip = getClientIp(req) ?? "unknown";
    await enforceRateLimit(`reset:${ip}`, "ip", {
      name: "auth:password-reset",
      windowMs: 3600 * 1000,
      limit: 3,
    });

    const body = await validateBody(req, requestResetSchema);

    const { rows } = await db.query<{
      id: string;
      display_name: string;
      email: string;
    }>(
      `SELECT id, display_name, email
       FROM users
       WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
       LIMIT 1`,
      [body.email]
    );

    // Always return 200 to prevent email enumeration
    if (!rows[0]) {
      return NextResponse.json({
        success: true,
        data: { message: "If that email is registered, a reset link has been sent." },
        error: null,
      });
    }

    const user = rows[0];

    // Invalidate any existing unused tokens for this user
    await db.query(
      `DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    // Generate a new token
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt.toISOString()]
    );

    // Send reset email (non-blocking)
    sendResetEmail(user.email, user.display_name, rawToken).catch((err) => {
      console.error("[password-reset] Failed to send email:", err);
    });

    return NextResponse.json({
      success: true,
      data: { message: "If that email is registered, a reset link has been sent." },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/auth/password-reset  — Complete reset
// ---------------------------------------------------------------------------

export const PATCH = async (req: NextRequest) => {
  try {
    const body = await validateBody(req, completeResetSchema);
    const tokenHash = hashToken(body.token);

    // Look up the token
    const { rows } = await db.query<{
      id: string;
      user_id: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    const tokenRow = rows[0];
    if (!tokenRow) throw badRequest("Invalid or expired reset token", "INVALID_TOKEN");
    if (tokenRow.used_at) throw badRequest("This reset link has already been used", "TOKEN_USED");
    if (new Date(tokenRow.expires_at) < new Date()) {
      throw badRequest("This reset link has expired. Please request a new one.", "TOKEN_EXPIRED");
    }

    // Hash the new password
    const { hash } = await import("bcryptjs");
    const passwordHash = await hash(body.newPassword, 12);

    // Update password and mark token as used atomically
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, tokenRow.user_id]
      );
      await tx.query(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
        [tokenRow.id]
      );
    });

    return NextResponse.json({
      success: true,
      data: { message: "Password reset successfully. You can now log in with your new password." },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
};
