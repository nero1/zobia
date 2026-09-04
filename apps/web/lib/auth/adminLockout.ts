/**
 * lib/auth/adminLockout.ts
 *
 * Anti-brute-force lockout for the staff (/gate44) login.
 *
 * After 3 failed attempts (wrong password OR wrong TOTP code) against the
 * same admin email, further login attempts are rejected until the admin
 * unlocks their own account with the "Secret Magic Word" they set in
 * advance (POST /api/admin/auth/magic-word, while logged in) via
 * POST /api/admin/auth/unlock.
 *
 * Counter lives in Redis only (no DB writes on every failed attempt) with a
 * 24h TTL as a fallback safety valve in case an admin never got around to
 * setting a magic word — see the reminder banner in AdminLayoutShell.
 */

import { redis } from "@/lib/redis";

const MAX_ATTEMPTS = 3;
const LOCKOUT_TTL_SECONDS = 24 * 60 * 60; // 24h fallback auto-expiry

function lockoutKey(email: string): string {
  return `admin_lockout:${email.toLowerCase()}`;
}

/** True if this admin email is currently locked out. */
export async function isAdminLockedOut(email: string): Promise<boolean> {
  const count = await redis.get(lockoutKey(email));
  return count !== null && parseInt(count, 10) >= MAX_ATTEMPTS;
}

/**
 * Record a failed login/TOTP attempt for this email. Returns the updated
 * failure count and whether the account is now locked.
 */
export async function recordAdminLoginFailure(
  email: string
): Promise<{ attempts: number; locked: boolean }> {
  const key = lockoutKey(email);
  const attempts = await redis.incr(key);
  await redis.expire(key, LOCKOUT_TTL_SECONDS);
  return { attempts, locked: attempts >= MAX_ATTEMPTS };
}

/** Clear the failure counter — call on a fully successful login, or a magic-word unlock. */
export async function clearAdminLockout(email: string): Promise<void> {
  await redis.del(lockoutKey(email));
}

export const ADMIN_LOCKOUT_MAX_ATTEMPTS = MAX_ATTEMPTS;
