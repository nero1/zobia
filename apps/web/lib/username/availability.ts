/**
 * lib/username/availability.ts
 *
 * Single shared source of truth for "is this username available to claim
 * right now" — consulted by registration (onboarding) AND the Username
 * Change feature, so a reserved/held username can never slip through either
 * path. Do not duplicate this logic elsewhere.
 *
 * A username is unavailable when:
 *   1. Format is invalid (length/charset/leading-trailing punctuation).
 *   2. It's on the reserved-word/profanity list.
 *   3. It's already taken by a live user (users.username, case-insensitive).
 *   4. It's under an active hold in username_reservations — this covers
 *      BOTH the "redirect forever" case (reserved_until IS NULL) and the
 *      temporary "no longer exists" hold (reserved_until > NOW()). The
 *      comparison against NOW() happens at read time so correctness never
 *      depends on any cleanup job running.
 */

import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";

// ---------------------------------------------------------------------------
// Format / policy rules (kept in sync with the original onboarding checker)
// ---------------------------------------------------------------------------

export const USERNAME_MIN_LEN = 3;
export const USERNAME_MAX_LEN = 30;
export const USERNAME_REGEX = /^[a-z0-9_-]+$/;

export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "superuser", "system",
  "support", "help", "staff", "team", "official",
  "zobia", "zobia_official", "zobiasocial",
  "api", "www", "mail", "ftp", "cdn", "assets",
  "home", "login", "logout", "register", "signup",
  "dashboard", "settings", "account", "profile",
  "about", "contact", "terms", "privacy", "legal",
  "null", "undefined", "anonymous", "guest", "user",
  "moderator", "mod", "bot", "service",
  "me", "new", "edit", "delete", "create",
]);

const PROFANITY_FRAGMENTS = [
  "fuck", "shit", "bitch", "asshole", "bastard",
  "cunt", "dick", "cock", "pussy", "nigger", "nigga",
  "faggot", "retard", "whore", "slut",
];

function containsProfanity(username: string): boolean {
  const lower = username.toLowerCase();
  return PROFANITY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

export interface UsernameFormatCheck {
  valid: boolean;
  reason?: string;
}

/** Format-only validation (length/charset) — no DB access. */
export function validateUsernameFormat(username: string): UsernameFormatCheck {
  if (username.length < USERNAME_MIN_LEN) {
    return { valid: false, reason: `Username must be at least ${USERNAME_MIN_LEN} characters` };
  }
  if (username.length > USERNAME_MAX_LEN) {
    return { valid: false, reason: `Username cannot exceed ${USERNAME_MAX_LEN} characters` };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { valid: false, reason: "Username may only contain lowercase letters, numbers, underscores, and hyphens" };
  }
  if (username.startsWith("-") || username.endsWith("-")) {
    return { valid: false, reason: "Username cannot start or end with a hyphen" };
  }
  if (username.startsWith("_") || username.endsWith("_")) {
    return { valid: false, reason: "Username cannot start or end with an underscore" };
  }
  return { valid: true };
}

export interface UsernameAvailability {
  available: boolean;
  reason?: string;
  /** Set when unavailable specifically because of an active reservation hold. */
  reservedUntil?: string | null;
}

interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Full availability check: format -> reserved words -> profanity -> live
 * users table -> username_reservations hold. Pass `excludeUserId` when
 * checking availability for a user's OWN current username (e.g. re-checking
 * inside the change transaction) so they don't collide with themselves.
 *
 * @param client Optional transaction client — pass the tx client when
 *   called from inside a transaction that must see it atomically.
 */
export async function checkUsernameAvailability(
  rawUsername: string,
  opts: { excludeUserId?: string; client?: Queryable | TransactionClient } = {}
): Promise<UsernameAvailability> {
  const username = rawUsername.toLowerCase().trim();
  const client: Queryable = (opts.client as Queryable | undefined) ?? db;

  const formatCheck = validateUsernameFormat(username);
  if (!formatCheck.valid) {
    return { available: false, reason: formatCheck.reason };
  }

  if (RESERVED_USERNAMES.has(username)) {
    return { available: false, reason: "This username is reserved" };
  }

  if (containsProfanity(username)) {
    return { available: false, reason: "This username is not allowed" };
  }

  const { rows: userRows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM users
       WHERE LOWER(username) = $1 AND deleted_at IS NULL
         ${opts.excludeUserId ? "AND id <> $2" : ""}
     ) AS exists`,
    opts.excludeUserId ? [username, opts.excludeUserId] : [username]
  );
  if (userRows[0]?.exists) {
    return { available: false, reason: "This username is already taken" };
  }

  const { rows: reservedRows } = await client.query<{ reserved_until: string | null }>(
    `SELECT reserved_until FROM username_reservations
     WHERE old_username = $1
       AND (reserved_until IS NULL OR reserved_until > NOW())
     LIMIT 1`,
    [username]
  );
  if (reservedRows[0]) {
    return {
      available: false,
      reason: "This username is reserved and cannot be claimed right now",
      reservedUntil: reservedRows[0].reserved_until,
    };
  }

  return { available: true };
}

// ---------------------------------------------------------------------------
// Reservation lookups (used by /u/[username] and /api/public/resolve)
// ---------------------------------------------------------------------------

export interface UsernameReservation {
  oldUsername: string;
  previousUserId: string;
  redirectToUsername: string | null;
  reservedUntil: string | null;
}

/**
 * Looks up an active OR expired hold on `oldUsername` (case-insensitive).
 * Callers decide what "active" means by comparing reservedUntil (null =
 * indefinite/never expires) against Date.now() themselves, OR just use
 * `resolveOldUsername` below which already applies that logic.
 */
export async function getUsernameReservation(
  oldUsername: string,
  client: Queryable = db
): Promise<UsernameReservation | null> {
  const { rows } = await client.query<{
    old_username: string;
    previous_user_id: string;
    redirect_to_username: string | null;
    reserved_until: string | null;
  }>(
    `SELECT old_username, previous_user_id, redirect_to_username, reserved_until
     FROM username_reservations WHERE old_username = $1 LIMIT 1`,
    [oldUsername.toLowerCase().trim()]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    oldUsername: row.old_username,
    previousUserId: row.previous_user_id,
    redirectToUsername: row.redirect_to_username,
    reservedUntil: row.reserved_until,
  };
}

export type OldUsernameResolution =
  | { kind: "redirect"; toUsername: string }
  | { kind: "gone"; reservedUntil: string }
  | { kind: "not_found" };

/**
 * Resolves what to show/do for a profile lookup that missed the live users
 * table, by consulting username_reservations. Lazy-expiry: a hold whose
 * reserved_until has passed resolves to "not_found" (plain, generic 404
 * copy) exactly as if the username had never existed — no cleanup job
 * required for this to be correct.
 */
export async function resolveOldUsername(
  oldUsername: string,
  client: Queryable = db
): Promise<OldUsernameResolution> {
  const reservation = await getUsernameReservation(oldUsername, client);
  if (!reservation) return { kind: "not_found" };

  if (reservation.redirectToUsername) {
    return { kind: "redirect", toUsername: reservation.redirectToUsername };
  }

  if (reservation.reservedUntil && new Date(reservation.reservedUntil).getTime() > Date.now()) {
    return { kind: "gone", reservedUntil: reservation.reservedUntil };
  }

  return { kind: "not_found" };
}
