/**
 * lib/auth/pinGuard.ts
 *
 * Server-side PIN verification guard.
 *
 * After a user successfully verifies their PIN via POST /api/auth/pin/verify,
 * a short-lived `pin_ok:{userId}:{sessionId}` key is set in Redis with a 5-minute TTL.
 * Sensitive endpoints (payouts, transfers, gifts) call `requirePinVerified`
 * to ensure this key exists before allowing the operation.
 *
 * Key lifecycle:
 *   SET  — POST /api/auth/pin/verify (on bcrypt match)
 *   CHECK — requirePinVerified() called in protected routes
 *   AUTO-EXPIRE — 5 minutes after set (Redis TTL)
 *
 * Keys are scoped per-session (userId + sessionId) so that a PIN verified in
 * one browser tab / device cannot authorize operations in a different session.
 */

import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";

/** TTL in seconds for the pin_ok key after a successful PIN verification. */
export const PIN_OK_TTL_SECONDS = 5 * 60; // 5 minutes

/**
 * Returns the Redis key used to track a verified PIN session for a user.
 * Scoped to both userId and sessionId to prevent cross-session authorization.
 */
export function pinOkKey(userId: string, sessionId: string): string {
  return `pin_ok:${userId}:${sessionId}`;
}

/**
 * Records a successful PIN verification for the given user session.
 * Should be called by POST /api/auth/pin/verify after bcrypt confirms the PIN.
 *
 * @param userId    - The authenticated user's UUID
 * @param sessionId - The session ID (sid) from the access token
 */
export async function markPinVerified(userId: string, sessionId: string): Promise<void> {
  await redis.set(pinOkKey(userId, sessionId), "1", "EX", PIN_OK_TTL_SECONDS);
}

/**
 * Checks whether the user has a valid (non-expired) PIN verification token
 * in Redis for this specific session. Returns true if the key exists, false otherwise.
 *
 * Callers should respond with 403 PIN_REQUIRED when this returns false.
 *
 * @param userId    - The authenticated user's UUID
 * @param sessionId - The session ID (sid) from the access token
 * @returns true if PIN was recently verified (within the last 5 minutes) for this session
 */
export async function requirePinVerified(userId: string, sessionId: string): Promise<boolean> {
  try {
    const value = await redis.get(pinOkKey(userId, sessionId));
    return value !== null;
  } catch (err) {
    // Fail closed on Redis outage — do not allow sensitive operations
    logger.error({ err, userId, sessionId }, "[pinGuard] Redis unavailable — failing closed");
    await db.query(
      `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
       VALUES ('redis_unavailable', 'critical', $1, $2::jsonb, NOW())`,
      [
        `pinGuard: Redis unavailable for user ${userId}`,
        JSON.stringify({ userId, sessionId }),
      ]
    ).catch(() => {});
    return false;
  }
}
