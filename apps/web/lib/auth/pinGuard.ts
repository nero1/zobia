/**
 * lib/auth/pinGuard.ts
 *
 * Server-side PIN verification guard.
 *
 * After a user successfully verifies their PIN via POST /api/auth/pin/verify,
 * a short-lived `pin_ok:{userId}` key is set in Redis with a 5-minute TTL.
 * Sensitive endpoints (payouts, transfers, gifts) call `requirePinVerified`
 * to ensure this key exists before allowing the operation.
 *
 * Key lifecycle:
 *   SET  — POST /api/auth/pin/verify (on bcrypt match)
 *   CHECK — requirePinVerified() called in protected routes
 *   AUTO-EXPIRE — 5 minutes after set (Redis TTL)
 */

import { redis } from "@/lib/redis";

/** TTL in seconds for the pin_ok key after a successful PIN verification. */
export const PIN_OK_TTL_SECONDS = 5 * 60; // 5 minutes

/**
 * Returns the Redis key used to track a verified PIN session for a user.
 */
export function pinOkKey(userId: string): string {
  return `pin_ok:${userId}`;
}

/**
 * Records a successful PIN verification for the given user.
 * Should be called by POST /api/auth/pin/verify after bcrypt confirms the PIN.
 *
 * @param userId - The authenticated user's UUID
 */
export async function markPinVerified(userId: string): Promise<void> {
  await redis.set(pinOkKey(userId), "1", "EX", PIN_OK_TTL_SECONDS);
}

/**
 * Checks whether the user has a valid (non-expired) PIN verification token
 * in Redis. Returns true if the `pin_ok:{userId}` key exists, false otherwise.
 *
 * Callers should respond with 403 PIN_REQUIRED when this returns false.
 *
 * @param userId - The authenticated user's UUID
 * @returns true if PIN was recently verified (within the last 5 minutes)
 */
export async function requirePinVerified(userId: string): Promise<boolean> {
  const value = await redis.get(pinOkKey(userId));
  return value !== null;
}
