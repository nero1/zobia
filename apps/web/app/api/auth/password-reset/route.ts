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
import {enqueueTask,processTask} from "@/lib/tasks/outbox";
import {encryptTaskPayload} from "@/lib/tasks/payloadEncryption";
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
  token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid reset token"),
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
    await enforceRateLimit(hashToken(body.email.trim().toLowerCase()),"ip",{name:"auth:reset-email",limit:3,windowMs:3600000,bypassL1:true});

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
        data: { message: "If that email is registered, a reset link will be sent." },
        error: null,
      });
    }

    const rawToken=randomBytes(32).toString("hex");
    const tokenHash=hashToken(rawToken);
    const taskId=await orm.transaction(async(tx)=>{
      const [current]=await tx.select({id:schema.users.id}).from(schema.users).where(and(eq(schema.users.id,user.id),eq(schema.users.email,user.email!),isNull(schema.users.deletedAt))).for("update");
      if(!current)return null;
      await tx.delete(schema.passwordResetTokens).where(and(eq(schema.passwordResetTokens.userId,user.id),isNull(schema.passwordResetTokens.usedAt)));
      const [token]=await tx.insert(schema.passwordResetTokens).values({userId:user.id,tokenHash,expiresAt:new Date(Date.now()+3600000)}).returning({id:schema.passwordResetTokens.id});
      return enqueueTask(tx,"password_reset_email",token.id,user.id,{tokenId:token.id,encrypted:encryptTaskPayload({email:user.email,name:user.displayName,token:rawToken})});
    });
    if(taskId)await processTask(taskId).catch(error=>logger.warn({errorType:error instanceof Error?error.name:"TaskError"},"Password reset delivery remains queued"));

    return NextResponse.json({
      success: true,
      data: { message: "If that email is registered, a reset link will be sent." },
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
    const ip = getClientIp(req);
    await enforceRateLimit(ip,"ip",{name:"auth:reset-complete",limit:10,windowMs:3600_000,globalLimit:100,bypassL1:true});
    const body = await validateBody(req, completeResetSchema);
    await enforceRateLimit(hashToken(body.token),"ip",{name:"auth:reset-token",limit:5,windowMs:3600_000,bypassL1:true});
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
      const [user] = await tx.select({id:schema.users.id}).from(schema.users).where(and(eq(schema.users.id,tokenRow.userId),isNull(schema.users.deletedAt))).for("update");
      if (!user) throw badRequest("Account unavailable", "INVALID_TOKEN");
      const consumed = await tx.update(schema.passwordResetTokens).set({usedAt:new Date()})
        .where(and(eq(schema.passwordResetTokens.id,tokenRow.id),isNull(schema.passwordResetTokens.usedAt),sql`${schema.passwordResetTokens.expiresAt}>NOW()`)).returning({id:schema.passwordResetTokens.id});
      if (!consumed.length) throw badRequest("Invalid or already used reset token", "INVALID_TOKEN");
      await tx.update(schema.users).set({passwordHash,sessionValidAfter:new Date(),updatedAt:new Date()}).where(eq(schema.users.id,tokenRow.userId));
      await tx.update(schema.passwordResetTokens).set({usedAt:new Date()}).where(and(eq(schema.passwordResetTokens.userId,tokenRow.userId),isNull(schema.passwordResetTokens.usedAt)));
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
