/**
 * app/api/onboarding/check-username/route.ts
 *
 * Username availability check endpoint.
 *
 * GET /api/onboarding/check-username?username=foo
 *   - Validates username format
 *   - Applies profanity filter (basic blocklist)
 *   - Checks reserved names list
 *   - Checks uniqueness in the database
 *   - Returns { available: boolean, reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum and maximum username character length. */
const USERNAME_MIN_LEN = 3;
const USERNAME_MAX_LEN = 30;

/** Allowed characters: lowercase letters, digits, underscores, hyphens. */
const USERNAME_REGEX = /^[a-z0-9_-]+$/;

/**
 * Reserved usernames that cannot be claimed by any user.
 * These include system routes, brand names, and common squatted names.
 */
const RESERVED_USERNAMES = new Set([
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

/**
 * Basic profanity blocklist (partial – extend for production).
 * Uses substring matching so variants are also caught.
 */
const PROFANITY_FRAGMENTS = [
  "fuck", "shit", "bitch", "asshole", "bastard",
  "cunt", "dick", "cock", "pussy", "nigger", "nigga",
  "faggot", "retard", "whore", "slut",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a username contains any profanity fragments.
 *
 * @param username - Lowercase username to check
 * @returns true if profanity detected
 */
function containsProfanity(username: string): boolean {
  const lower = username.toLowerCase();
  return PROFANITY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Validate the username format and policy.
 *
 * @param username - Raw username string to validate
 * @returns { valid: boolean, reason?: string }
 */
function validateUsernameFormat(username: string): {
  valid: boolean;
  reason?: string;
} {
  if (username.length < USERNAME_MIN_LEN) {
    return {
      valid: false,
      reason: `Username must be at least ${USERNAME_MIN_LEN} characters`,
    };
  }
  if (username.length > USERNAME_MAX_LEN) {
    return {
      valid: false,
      reason: `Username cannot exceed ${USERNAME_MAX_LEN} characters`,
    };
  }
  if (!USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      reason:
        "Username may only contain lowercase letters, numbers, underscores, and hyphens",
    };
  }
  if (username.startsWith("-") || username.endsWith("-")) {
    return {
      valid: false,
      reason: "Username cannot start or end with a hyphen",
    };
  }
  if (username.startsWith("_") || username.endsWith("_")) {
    return {
      valid: false,
      reason: "Username cannot start or end with an underscore",
    };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// GET /api/onboarding/check-username
// ---------------------------------------------------------------------------

/**
 * Check if a username is available for registration.
 *
 * @returns JSON { available: boolean, reason?: string }
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.onboarding);

    const { searchParams } = new URL(req.url);
    const rawUsername = searchParams.get("username");

    if (!rawUsername) {
      throw badRequest("username query parameter is required");
    }

    // Normalise to lowercase
    const username = rawUsername.toLowerCase().trim();

    // 1. Format validation
    const formatCheck = validateUsernameFormat(username);
    if (!formatCheck.valid) {
      return NextResponse.json(
        { available: false, reason: formatCheck.reason },
        { status: 200 }
      );
    }

    // 2. Reserved names check
    if (RESERVED_USERNAMES.has(username)) {
      return NextResponse.json(
        { available: false, reason: "This username is reserved" },
        { status: 200 }
      );
    }

    // 3. Profanity filter
    if (containsProfanity(username)) {
      return NextResponse.json(
        { available: false, reason: "This username is not allowed" },
        { status: 200 }
      );
    }

    // 4. Database uniqueness check
    const { rows } = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM users
         WHERE LOWER(username) = $1 AND deleted_at IS NULL
       ) AS exists`,
      [username]
    );

    const taken = rows[0]?.exists ?? false;
    if (taken) {
      return NextResponse.json(
        { available: false, reason: "This username is already taken" },
        { status: 200 }
      );
    }

    return NextResponse.json({ available: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
