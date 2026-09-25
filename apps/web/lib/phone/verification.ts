/**
 * lib/phone/verification.ts
 *
 * Phone-number capture for the Settings "Phone Number" field, feeding
 * users.phone_number (used by the contacts cross-reference feature,
 * app/api/users/contacts/cross-reference/route.ts).
 *
 * Verification is admin-gated and OFF by default (x_manifest
 * `phone_verification_required`, see lib/manifest/index.ts):
 *
 *   - OFF (default): the typed number is normalised and saved immediately,
 *     unverified. Matches the platform's baseline "No SMS anything" policy
 *     (ZobiaSocial-PRD.md §22) — no SMS is ever sent.
 *   - ON: the number is held in `phone_verification_codes` until the user
 *     confirms a 6-digit code sent via SMS (lib/notifications/sms.ts, the
 *     same Termii integration otherwise reserved for admin/mod alert
 *     paging). Only then is it written to users.phone_number, and
 *     users.phone_verified_at is stamped.
 *
 * One pending code per user (phone_verification_codes.user_id is the PK) —
 * requesting a new code overwrites any still-pending one.
 */

import { randomInt, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { loadManifest } from "@/lib/manifest";
import { sendSms } from "@/lib/notifications/sms";
import { toE164, isValidPhoneNumber } from "@/lib/phone/normalize";
import { badRequest, notFound, tooManyRequests } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, "0");
}

/** Peppered so a leaked `phone_verification_codes` row alone can't be brute-forced offline against a plain SHA-256 rainbow table. */
function hashCode(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StartPhoneVerificationResult {
  /** True if an SMS was sent and confirmPhoneVerification() must be called next. False if the number was saved immediately (verification off). */
  requiresVerification: boolean;
  /** Only set when requiresVerification is true. */
  expiresInSeconds?: number;
}

/**
 * Begin capturing a phone number for `userId`.
 *
 * @throws `BAD_REQUEST` if the number doesn't normalise to a plausible E.164 number, or if SMS sending fails.
 */
export async function startPhoneVerification(
  userId: string,
  rawPhoneNumber: string,
  txClient?: DbOrTx
): Promise<StartPhoneVerificationResult> {
  if (!isValidPhoneNumber(rawPhoneNumber)) {
    throw badRequest("Enter a valid phone number, e.g. +2348012345678.", "INVALID_PHONE_NUMBER");
  }
  const phoneNumber = toE164(rawPhoneNumber) as string;

  const client = txClient ?? (await getDb());
  const manifest = await loadManifest();

  if (!manifest.phoneVerificationRequired) {
    await client
      .update(schema.users)
      .set({ phoneNumber, phoneVerifiedAt: null, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
    // Drop any stale pending code from a prior window when verification was on.
    await client.delete(schema.phoneVerificationCodes).where(eq(schema.phoneVerificationCodes.userId, userId));
    return { requiresVerification: false };
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await client
    .insert(schema.phoneVerificationCodes)
    .values({ userId, phoneNumber, codeHash: hashCode(userId, code), attempts: 0, expiresAt })
    .onConflictDoUpdate({
      target: schema.phoneVerificationCodes.userId,
      set: { phoneNumber, codeHash: hashCode(userId, code), attempts: 0, expiresAt, createdAt: new Date() },
    });

  const result = await sendSms(phoneNumber, `Your Zobia verification code is ${code}. It expires in 10 minutes.`);
  if (!result.ok) {
    logger.error({ userId, error: result.error }, "[phone/verification] SMS send failed");
    // Roll back the pending row so a failed send doesn't block a retry via onConflictDoUpdate's stale expiry.
    await client.delete(schema.phoneVerificationCodes).where(eq(schema.phoneVerificationCodes.userId, userId));
    throw badRequest("Couldn't send the verification code. Please try again shortly.", "SMS_SEND_FAILED");
  }

  return { requiresVerification: true, expiresInSeconds: CODE_TTL_MS / 1000 };
}

/**
 * Confirm a pending phone verification code for `userId`.
 *
 * @throws `NOT_FOUND` if no code is pending, `BAD_REQUEST` (code "CODE_EXPIRED") if it expired,
 *         `RATE_LIMITED` if the attempt cap was hit, `BAD_REQUEST` (code "INVALID_CODE") on mismatch.
 * @returns The now-verified, normalised phone number.
 */
export async function confirmPhoneVerification(
  userId: string,
  code: string,
  txClient?: DbOrTx
): Promise<{ phoneNumber: string }> {
  const client = txClient ?? (await getDb());

  const rows = await client
    .select()
    .from(schema.phoneVerificationCodes)
    .where(eq(schema.phoneVerificationCodes.userId, userId))
    .limit(1);
  const pending = rows[0];
  if (!pending) {
    throw notFound("No pending phone verification. Request a new code.");
  }

  if (pending.expiresAt.getTime() < Date.now()) {
    await client.delete(schema.phoneVerificationCodes).where(eq(schema.phoneVerificationCodes.userId, userId));
    throw badRequest("This code has expired. Request a new one.", "CODE_EXPIRED");
  }

  if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
    await client.delete(schema.phoneVerificationCodes).where(eq(schema.phoneVerificationCodes.userId, userId));
    throw tooManyRequests("Too many incorrect attempts. Request a new code.");
  }

  if (hashCode(userId, code.trim()) !== pending.codeHash) {
    await client
      .update(schema.phoneVerificationCodes)
      .set({ attempts: pending.attempts + 1 })
      .where(eq(schema.phoneVerificationCodes.userId, userId));
    throw badRequest("Incorrect code. Please try again.", "INVALID_CODE");
  }

  await client
    .update(schema.users)
    .set({ phoneNumber: pending.phoneNumber, phoneVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await client.delete(schema.phoneVerificationCodes).where(eq(schema.phoneVerificationCodes.userId, userId));

  return { phoneNumber: pending.phoneNumber };
}

/** Remove the user's phone number (and any pending code). Always allowed regardless of the verification-required toggle. */
export async function clearPhoneNumber(userId: string, txClient?: DbOrTx): Promise<void> {
  const client = txClient ?? (await getDb());
  await client
    .update(schema.users)
    .set({ phoneNumber: null, phoneVerifiedAt: null, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await client.delete(schema.phoneVerificationCodes).where(eq(schema.phoneVerificationCodes.userId, userId));
}
