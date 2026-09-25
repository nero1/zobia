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
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";
import { verifyCaptcha, getCaptchaProvider } from "@/lib/security/captcha";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const requestResetSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  captchaToken: z.string().optional(),
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

    // CAPTCHA verification — provider controlled via x_manifest (captcha_provider key)
    const captchaProvider = await getCaptchaProvider();
    if (captchaProvider !== "none") {
      const captchaOk = await verifyCaptcha(body.captchaToken ?? "", ip, "password_reset");
      if (!captchaOk) throw badRequest("CAPTCHA verification failed", "CAPTCHA_FAILED");
    }

    const orm = await getDb();
    const [user] = await orm
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(and(sql`LOWER(${schema.users.email}) = LOWER(${body.email})`, isNull(schema.users.deletedAt)))
      .limit(1);

    // Always return 200 to prevent email enumeration
    if (!user) {
      return NextResponse.json({
        success: true,
        data: { message: "If that email is registered, a reset link has been sent." },
        error: null,
      });
    }

    // Invalidate any existing unused tokens for this user
    await orm
      .delete(schema.passwordResetTokens)
      .where(and(eq(schema.passwordResetTokens.userId, user.id), isNull(schema.passwordResetTokens.usedAt)));

    // Generate a new token
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await orm.insert(schema.passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    // Send reset email (non-blocking). user.email is guaranteed non-null here
    // since the lookup above matched on LOWER(email) = LOWER(body.email).
    sendResetEmail(user.email as string, user.displayName, rawToken).catch((err) => {
      logger.error({ err, userId: user.id }, "[password-reset] Failed to send email");
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
    const orm = await getDb();
    const [tokenRow] = await orm
      .select({
        id: schema.passwordResetTokens.id,
        userId: schema.passwordResetTokens.userId,
        expiresAt: schema.passwordResetTokens.expiresAt,
        usedAt: schema.passwordResetTokens.usedAt,
      })
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!tokenRow) throw badRequest("Invalid or expired reset token", "INVALID_TOKEN");
    if (tokenRow.usedAt) throw badRequest("This reset link has already been used", "TOKEN_USED");
    if (new Date(tokenRow.expiresAt) < new Date()) {
      throw badRequest("This reset link has expired. Please request a new one.", "TOKEN_EXPIRED");
    }

    // Hash the new password
    const { hash } = await import("bcryptjs");
    const passwordHash = await hash(body.newPassword, 12);

    // Update password and mark token as used atomically
    await orm.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(schema.users.id, tokenRow.userId));
      await tx
        .update(schema.passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.passwordResetTokens.id, tokenRow.id));
    });

    // Revoke all existing sessions so a compromised old session cannot survive the reset
    const { invalidateAllSessions } = await import("@/lib/auth/session");
    await invalidateAllSessions(tokenRow.userId).catch((err) => {
      logger.error({ err, userId: tokenRow.userId }, "[password-reset] Failed to invalidate sessions");
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
