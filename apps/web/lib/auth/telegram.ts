/**
 * lib/auth/telegram.ts
 *
 * Telegram Login Widget verification.
 *
 * Telegram sends a signed hash with each login payload.
 * We verify it server-side using HMAC-SHA256 with the bot token as the key.
 *
 * Reference: https://core.telegram.org/widgets/login#checking-authorization
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw data object sent by the Telegram Login Widget.
 * All fields except `hash` contribute to the verification string.
 */
export interface TelegramLoginData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;   // Unix timestamp
  hash: string;
}

/** Normalised Telegram user profile after verification. */
export interface TelegramUserProfile {
  /** Telegram's stable numeric user ID (as string for DB storage). */
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  /** Unix timestamp when the user authenticated. */
  authDate: number;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Maximum age of a Telegram auth payload before we reject it (seconds). */
const MAX_AUTH_AGE_SECONDS = 600; // 10 minutes

/**
 * Verify the Telegram Login Widget payload.
 *
 * Steps (per Telegram docs):
 *   1. Build a data-check-string by sorting all fields (except hash) alphabetically
 *      and joining with newlines: `key=value\nkey=value`
 *   2. Compute `secret_key = SHA-256(bot_token)`
 *   3. Compute `expected_hash = HMAC-SHA256(data_check_string, secret_key)`
 *   4. Compare with the received `hash` (constant-time)
 *   5. Reject if `auth_date` is older than MAX_AUTH_AGE_SECONDS
 *
 * @param data - Raw Telegram login data (e.g. parsed from query string)
 * @returns Normalised profile if valid
 * @throws if the hash is invalid or the payload is too old
 */
export function verifyTelegramLogin(data: TelegramLoginData): TelegramUserProfile {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram login is not configured (TELEGRAM_BOT_TOKEN missing)");
  }

  const { hash, ...fields } = data;

  // 1. Build the check string
  const checkString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // 2. Derive secret key: SHA-256 of the bot token
  const secretKey = createHash("sha256")
    .update(env.TELEGRAM_BOT_TOKEN)
    .digest();

  // 3. Compute expected HMAC
  const expectedHash = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  // 4. Constant-time comparison (ZB-24: guard length before comparing)
  const expectedBuf = Buffer.from(expectedHash, "hex");
  const presentedBuf = Buffer.from(hash.length === expectedHash.length ? hash : "", "hex");
  if (expectedBuf.length !== presentedBuf.length || !timingSafeEqual(expectedBuf, presentedBuf)) {
    throw new Error("Telegram login verification failed: invalid hash");
  }

  // 5. Check freshness
  const ageSeconds = Math.floor(Date.now() / 1000) - data.auth_date;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS) {
    throw new Error(
      `Telegram login verification failed: payload is ${ageSeconds}s old (max ${MAX_AUTH_AGE_SECONDS}s)`
    );
  }

  return {
    telegramId: String(data.id),
    firstName: data.first_name,
    lastName: data.last_name,
    username: data.username,
    photoUrl: data.photo_url,
    authDate: data.auth_date,
  };
}

/**
 * Parse Telegram login data from a URL search params object (callback URL).
 *
 * @param params - URLSearchParams from the callback request
 * @returns Raw Telegram login data or null if required fields are missing
 */
export function parseTelegramParams(
  params: URLSearchParams
): TelegramLoginData | null {
  const id = params.get("id");
  const firstName = params.get("first_name");
  const hash = params.get("hash");
  const authDate = params.get("auth_date");

  if (!id || !firstName || !hash || !authDate) return null;

  return {
    id: Number(id),
    first_name: firstName,
    last_name: params.get("last_name") ?? undefined,
    username: params.get("username") ?? undefined,
    photo_url: params.get("photo_url") ?? undefined,
    auth_date: Number(authDate),
    hash,
  };
}
