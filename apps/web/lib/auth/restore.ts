/**
 * lib/auth/restore.ts
 *
 * Account restoration flow for soft-deleted accounts.
 * Generates a time-limited signed token and emails it to the user.
 * Upon token validation, the account is reactivated.
 */

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
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
  return new jose.SignJWT({ sub: userId, purpose: "account_restore" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${RESTORE_TOKEN_TTL_SECONDS}s`)
    .sign(getRestoreSecret());
}

export async function verifyRestoreToken(token: string): Promise<{ userId: string; jti: string } | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getRestoreSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "account_restore" || typeof payload.sub !== "string" || typeof payload.jti !== "string") {
      return null;
    }
    return { userId: payload.sub, jti: payload.jti };
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
export async function initiateAccountRestore(email: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string; email: string; display_name: string | null }>(
    `SELECT id, email, display_name
     FROM users
     WHERE LOWER(email) = LOWER($1) AND deleted_at IS NOT NULL
     LIMIT 1`,
    [email]
  );

  const user = rows[0];
  if (!user) return false;

  const rawToken = await signRestoreToken(user.id);
  const restoreUrl = `${env.NEXT_PUBLIC_APP_URL}/auth/restore?token=${encodeURIComponent(rawToken)}`;
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
    return false;
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
}

/**
 * Completes account restoration from a signed restore token.
 * Clears deleted_at, logs the action, and returns a new session token pair.
 */
export async function completeAccountRestore(token: string): Promise<RestoreResult> {
  const payload = await verifyRestoreToken(token);
  if (!payload) {
    return { success: false, error: "Invalid or expired restore token" };
  }

  const { userId, jti } = payload;

  // BUG-45 FIX: single-use token enforcement via Redis.
  // If the jti was already consumed, reject immediately to prevent replay.
  const usedKey = `restore:used:${jti}`;
  const alreadyUsed = await redis.exists(usedKey).catch(() => 0);
  if (alreadyUsed) {
    return { success: false, error: "Restore link has already been used. Please request a new one." };
  }

  const { rows } = await db.query<{
    id: string;
    email: string | null;
    username: string;
    is_admin: boolean;
    is_moderator: boolean;
    is_creator: boolean;
    display_name: string | null;
    deleted_at: string | null;
  }>(
    `UPDATE users
     SET deleted_at = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING id, email, username, is_admin, is_moderator, is_creator, display_name, deleted_at`,
    [userId]
  );

  if (!rows[0]) {
    return { success: false, error: "Account not found or is already active" };
  }

  const user = rows[0];

  // Audit log
  await db.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, metadata, created_at)
     VALUES ($1, 'account_restore', 'user', $2, $3::jsonb, NOW())`,
    [userId, userId, JSON.stringify({ method: "self_restore_token" })]
  ).catch(() => {});

  // Mark token as consumed so it cannot be replayed.
  await redis.set(usedKey, "1", "EX", RESTORE_TOKEN_TTL_SECONDS).catch(() => {});

  // Issue new session tokens
  try {
    const { accessToken, refreshToken } = await createSession({
      id: user.id,
      email: user.email ?? "",
      username: user.username,
      is_admin: user.is_admin,
      is_moderator: user.is_moderator,
      is_creator: user.is_creator,
    });
    return { success: true, accessToken, refreshToken };
  } catch (err) {
    logger.error({ err, userId }, "[restore] Session creation failed after restore");
    return { success: false, error: "Account restored but session creation failed — please log in manually" };
  }
}
