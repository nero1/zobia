/**
 * lib/auth/restore.ts
 *
 * Account restoration flow for soft-deleted accounts.
 * Generates a time-limited signed token and emails it to the user.
 * Upon token validation, the account is reactivated.
 */

import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { signAccessToken } from "@/lib/auth/jwt";
import { randomBytes } from "node:crypto";
import { createSession } from "@/lib/auth/session";
import { redis } from "@/lib/redis";
import * as jose from "jose";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const RESTORE_TOKEN_TTL_SECONDS = 48 * 60 * 60; // 48 hours

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function getRestoreSecret(): Uint8Array {
  const secret = env.JWT_SECRET;
  return new TextEncoder().encode(secret + ":account_restore");
}

export async function signRestoreToken(userId: string): Promise<string> {
  const db = await getDb();
  const [deleted] = await db.select({ at: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, userId));
  if (!deleted?.at) throw new Error("Account is not deleted");
  return new jose.SignJWT({ sub: userId, purpose: "account_restore", deletion: deleted.at.toISOString() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${RESTORE_TOKEN_TTL_SECONDS}s`)
    .sign(getRestoreSecret());
}

export async function verifyRestoreToken(token: string): Promise<{ userId: string; jti: string; deletion: string } | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getRestoreSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "account_restore" || typeof payload.sub !== "string" || typeof payload.jti !== "string" || typeof payload.deletion !== "string") {
      return null;
    }
    return { userId: payload.sub, jti: payload.jti, deletion: payload.deletion as string };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Initiate restore — generates token and emails user
// ---------------------------------------------------------------------------

/**
 * Initiates an account restore for a soft-deleted user.
 * Sends a signed restore link to the user's email (48h TTL).
 *
 * @param email - The registered email of the deleted account
 * @returns true if the email was found and restore email sent; false otherwise
 */
export async function initiateAccountRestore(email:string):Promise<boolean>{
  const db=await getDb();
  const result=await db.execute<{id:string}>(sql`SELECT id FROM users WHERE LOWER(email)=LOWER(${email}) AND deleted_at>NOW()-INTERVAL '30 days' AND NOT is_banned AND NOT(is_suspended AND (suspended_until IS NULL OR suspended_until>NOW())) LIMIT 1`);
  const user=result.rows[0];if(!user)return false;
  const {queueRestoreEmail,processRestoreEmail}=await import('@/lib/notifications/restoreQueue');
  await queueRestoreEmail(user.id);
  await processRestoreEmail(user.id).catch(error=>logger.error({errorType:error instanceof Error?error.name:'Error'},'[restore] Delivery queued for retry'));
  return true;
}

/** Only the durable delivery worker calls this; links are generated at send time. */
export async function deliverAccountRestoreEmail(userId:string):Promise<boolean>{
  const db=await getDb();
  const result=await db.execute<{id:string;email:string;display_name:string|null}>(sql`SELECT id,email,display_name FROM users WHERE id=${userId} AND email IS NOT NULL AND deleted_at>NOW()-INTERVAL '30 days' AND NOT is_banned AND NOT(is_suspended AND (suspended_until IS NULL OR suspended_until>NOW())) LIMIT 1`);
  const user=result.rows[0];if(!user)return false;
  const rawToken = await signRestoreToken(user.id);
  // BUG-AUTH-01 FIX: use a URL fragment (#token=) so the token is never sent in
  // server request logs or Referer headers when the user clicks the link.
  // The restore page reads window.location.hash and POSTs the token to the API.
  const restoreUrl = `${env.NEXT_PUBLIC_APP_URL}/auth/restore#token=${encodeURIComponent(rawToken)}`;
  const displayName = user.display_name ?? "there";

  try {
    const { sendEmail } = await import("@/lib/notifications/email");
    const safeDisplayName = escapeHtml(displayName);
    await sendEmail(
      user.email,
      "Restore your Zobia account",
      `Hi ${displayName}, click the link to restore your account: ${restoreUrl} (expires in 48 hours)`,
      `<p>Hi ${safeDisplayName},</p>
       <p>We received a request to restore your Zobia Social account.</p>
       <p><a href="${restoreUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Restore Account</a></p>
       <p>This link expires in 48 hours. If you didn't request this, you can safely ignore this email.</p>`,
      "security"
    );
  } catch (err) {
    logger.error({ err, userId: user.id }, "[restore] Failed to send restore email");
    throw err;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Complete restore — validates token and reactivates account
// ---------------------------------------------------------------------------

export interface RestoreResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  preAuthCode?: string;
  requiresAdminLogin?:boolean;
  expiresIn?: number;
  refreshTtl?: number;
}

/**
 * Completes account restoration from a signed restore token.
 * Clears deleted_at, logs the action, and returns a new session token pair.
 */
export async function completeAccountRestore(
  token: string,
  options: { ip?: string; ua?: string } = {}
): Promise<RestoreResult> {
  const payload = await verifyRestoreToken(token);
  if (!payload) {
    return { success: false, error: "Invalid or expired restore token" };
  }

  const { userId, jti, deletion } = payload;
  const db = await getDb();
  const row = await db.transaction(async tx => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).for("update");
    if (!user?.deletedAt || user.deletedAt.toISOString() !== deletion || user.isBanned || (user.isSuspended && (!user.suspendedUntil || user.suspendedUntil > new Date())) || user.deletedAt.getTime() < Date.now() - 30 * 86400_000) return null;
    const used = await tx.execute(sql`INSERT INTO account_restore_uses(jti,user_id) VALUES (${jti},${userId}) ON CONFLICT DO NOTHING RETURNING jti`);
    if (!used.rowCount) return null;
    await tx.update(schema.users).set({ deletedAt: null, updatedAt: new Date() }).where(eq(schema.users.id,userId));
    await tx.insert(schema.adminAuditLog).values({ adminId:userId, action:"account_restore", targetType:"user", targetId:userId, metadata:{method:"self_restore_token"} });
    return user;
  });
  if (!row) return { success:false, error:"Restore token is unavailable or account cannot be restored" };
  if(row.isAdmin)return {success:true,requiresAdminLogin:true};
  if (row.totpEnabled) {
    const pre = await signAccessToken({sub:row.id,username:row.username,is_admin:row.isAdmin,sid:"pre_auth",type:"pre_auth"},300);
    const code = randomBytes(32).toString("hex");
    await redis.pipeline().setex(`pre_auth:${row.id}`,300,pre).setex(`web_pre_auth:${code}`,300,pre).exec();
    return { success:true, preAuthCode:code };
  }

  const user = {
    id: row.id,
    email: row.email,
    username: row.username,
    is_admin: row.isAdmin,
    is_moderator: row.isModerator,
    is_creator: row.isCreator,
    display_name: row.displayName,
    deleted_at: row.deletedAt,
  };

  // Issue new session tokens
  try {
    const { accessToken, refreshToken, expiresIn, refreshTtl } = await createSession(
      {
        id: user.id,
        email: user.email ?? "",
        username: user.username,
        is_admin: user.is_admin,
        is_moderator: user.is_moderator,
        is_creator: user.is_creator,
      },
      options
    );
    return { success: true, accessToken, refreshToken, expiresIn, refreshTtl };
  } catch (err) {
    logger.error({ err, userId }, "[restore] Session creation failed after restore");
    return { success: false, error: "Account restored but session creation failed — please log in manually" };
  }
}
