/**
 * lib/auth/pinAttempts.ts
 *
 * Single choke point for checking a user's 4-digit PIN: failed-attempt
 * counting, temporary lockout and escalation.
 *
 * A 4-digit PIN only has 10,000 combinations, so EVERY code path that compares
 * a submitted PIN against `user_pins.pin_hash` (verify, change, remove, bank
 * account / wallet address edits, PIN reset) must go through
 * {@link verifyPinAttempt}. Previously only POST /api/auth/pin/verify counted
 * failures, so the other routes were brute-forceable at their (much looser)
 * request rate limits.
 *
 * Policy (defaults, see constants below):
 *   - 5 wrong PINs within 15 minutes  -> locked for 15 minutes
 *   - 3 lockouts within 24 hours      -> locked for 24 hours
 *   - a correct PIN clears the failure counter
 *   - a successful PIN reset (see /api/auth/pin/reset) clears every counter
 *
 * Redis cost: the happy path is one GET (lock check) + one DEL. Counters are
 * only written on a wrong PIN, so normal use is not penalised.
 */

import bcrypt from "bcryptjs";
import { redis } from "@/lib/redis";
import { ApiError } from "@/lib/api/errors";
import { loadManifest } from "@/lib/manifest";

/**
 * Default policy. The live values are admin-editable (x_manifest `pin_*` keys,
 * /gate44/config -> "Auth"; manifest.pinLockout) and read per call through the
 * manifest's in-process cache, so a change costs no extra Redis calls.
 */
export const PIN_MAX_FAILED_ATTEMPTS = 5;
export const PIN_FAIL_WINDOW_SECONDS = 15 * 60;
export const PIN_LOCKOUT_SECONDS = 15 * 60;
export const PIN_STRIKE_LIMIT = 3;
export const PIN_STRIKE_WINDOW_SECONDS = 24 * 60 * 60;
export const PIN_LONG_LOCKOUT_SECONDS = 24 * 60 * 60;

interface PinPolicy {
  maxFailedAttempts: number;
  failWindowSeconds: number;
  lockoutSeconds: number;
  strikeLimit: number;
  strikeWindowSeconds: number;
  longLockoutSeconds: number;
}

const DEFAULT_POLICY: PinPolicy = {
  maxFailedAttempts: PIN_MAX_FAILED_ATTEMPTS,
  failWindowSeconds: PIN_FAIL_WINDOW_SECONDS,
  lockoutSeconds: PIN_LOCKOUT_SECONDS,
  strikeLimit: PIN_STRIKE_LIMIT,
  strikeWindowSeconds: PIN_STRIKE_WINDOW_SECONDS,
  longLockoutSeconds: PIN_LONG_LOCKOUT_SECONDS,
};

async function getPolicy(): Promise<PinPolicy> {
  try {
    const c = (await loadManifest()).pinLockout;
    return {
      maxFailedAttempts: c.maxFailedAttempts,
      failWindowSeconds: c.failWindowMinutes * 60,
      lockoutSeconds: c.lockoutMinutes * 60,
      strikeLimit: c.strikeLimit,
      strikeWindowSeconds: c.strikeWindowHours * 3600,
      longLockoutSeconds: c.longLockoutHours * 3600,
    };
  } catch {
    return DEFAULT_POLICY; // manifest unavailable: fail to the safe defaults
  }
}

const failKey = (userId: string) => `pin_fail:${userId}`;
const lockKey = (userId: string) => `pin_lock:${userId}`;
const strikeKey = (userId: string) => `pin_strikes:${userId}`;

export interface PinAttemptResult {
  verified: boolean;
  /** Wrong attempts left before the lockout kicks in (only when !verified). */
  attemptsRemaining?: number;
}

function lockedError(retryAfterSeconds: number): ApiError {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return new ApiError(
    429,
    "PIN_LOCKED",
    `Too many incorrect PIN attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your PIN.`,
    undefined,
    { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
    { minutes }
  );
}

/** Throws 429 PIN_LOCKED while the user is locked out. */
export async function assertPinNotLocked(userId: string): Promise<void> {
  const ttl = await redis.ttl(lockKey(userId));
  // ttl: -2 = no key, -1 = key without expiry (treat as locked for a full period)
  if (ttl === -2) return;
  throw lockedError(ttl > 0 ? ttl : (await getPolicy()).lockoutSeconds);
}

/** Clear the failure counter (correct PIN). */
export async function clearPinFailures(userId: string): Promise<void> {
  await redis.del(failKey(userId)).catch(() => {});
}

/** Clear counters AND any active lock (used after a verified PIN reset). */
export async function resetPinLockout(userId: string): Promise<void> {
  await redis.del(failKey(userId), lockKey(userId), strikeKey(userId)).catch(() => {});
}

/** Record a wrong PIN; throws PIN_LOCKED if this attempt triggers a lockout. */
async function recordPinFailure(userId: string): Promise<number> {
  const policy = await getPolicy();
  const failures = await redis.incr(failKey(userId));
  if (failures === 1) await redis.expire(failKey(userId), policy.failWindowSeconds);

  if (failures >= policy.maxFailedAttempts) {
    const strikes = await redis.incr(strikeKey(userId));
    if (strikes === 1) await redis.expire(strikeKey(userId), policy.strikeWindowSeconds);
    const lockSeconds = strikes >= policy.strikeLimit ? policy.longLockoutSeconds : policy.lockoutSeconds;
    await redis.set(lockKey(userId), "1", "EX", lockSeconds);
    await redis.del(failKey(userId));
    throw lockedError(lockSeconds);
  }
  return policy.maxFailedAttempts - failures;
}

/**
 * Compare `pin` with the stored bcrypt hash, applying lockout policy.
 *
 * @throws ApiError 429 PIN_LOCKED when locked before or because of this attempt.
 */
export async function verifyPinAttempt(
  userId: string,
  pin: string,
  pinHash: string
): Promise<PinAttemptResult> {
  await assertPinNotLocked(userId);
  const verified = await bcrypt.compare(pin, pinHash);
  if (verified) {
    await clearPinFailures(userId);
    return { verified: true };
  }
  return { verified: false, attemptsRemaining: await recordPinFailure(userId) };
}

/**
 * Like {@link verifyPinAttempt} but throws 400 INVALID_PIN on a wrong PIN.
 * (Deliberately NOT 401: the client's global 401 handling would mistake a typo
 * for an expired session and sign the user out.)
 */
export async function requireCorrectPin(userId: string, pin: string, pinHash: string): Promise<void> {
  const result = await verifyPinAttempt(userId, pin, pinHash);
  if (!result.verified) {
    throw new ApiError(
      400,
      "INVALID_PIN",
      "Incorrect PIN",
      undefined,
      undefined,
      { attemptsRemaining: result.attemptsRemaining }
    );
  }
}
