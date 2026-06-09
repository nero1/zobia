export const dynamic = 'force-dynamic';

/**
 * app/api/users/contacts/cross-reference/route.ts
 *
 * POST /api/users/contacts/cross-reference
 *
 * Cross-reference a list of device phone numbers against Zobia users.
 * Used during onboarding to surface which of the caller's contacts are
 * already on the platform (PRD §4 Step 4).
 *
 * Privacy note: phone numbers are never stored server-side as a result
 * of this call. They are compared in-query against the existing
 * `users.phone_number` column and immediately discarded.
 *
 * Auth required.
 * Body: { phoneNumbers: string[] }   — max 500 entries per request.
 * Returns: { contacts: ZobiaContactResult[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum phone numbers accepted per request. */
const MAX_PHONE_NUMBERS = 500;

/** Maximum users returned per request (guards against wide-open enumeration). */
const MAX_RESULTS = 100;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const crossReferenceSchema = z.object({
  /**
   * Array of normalised phone numbers from the device phonebook.
   * Normalisation (stripping spaces, dashes, parentheses) is expected to
   * have been applied by the client before sending. Numbers that do not
   * match any Zobia user are silently ignored.
   */
  phoneNumbers: z
    .array(z.string().min(1).max(20))
    .min(1, "At least one phone number is required")
    .max(MAX_PHONE_NUMBERS, `Maximum ${MAX_PHONE_NUMBERS} phone numbers per request`),
});

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface UserMatchRow {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
  phone_number: string;
}

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface ZobiaContactResult {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  /**
   * Always returns the sentinel value `"[matched]"` — the actual phone
   * number is never echoed back to protect user privacy.
   */
  phoneNumber: "[matched]";
}

// ---------------------------------------------------------------------------
// POST /api/users/contacts/cross-reference
// ---------------------------------------------------------------------------

/**
 * Find Zobia users whose phone number matches any number in the provided list.
 *
 * Only users who have a verified phone number stored in the `users` table
 * will ever appear in results. Since most users authenticate via Google or
 * Telegram (which do not capture a phone number), the result set will
 * frequently be empty — this is expected and the UI handles it gracefully.
 *
 * @param req - Incoming request with `{ phoneNumbers: string[] }` body
 * @returns `{ contacts: ZobiaContactResult[] }` — empty array if no matches
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const callerId = auth.user.sub;

    const body = await validateBody(req, crossReferenceSchema);
    const { phoneNumbers } = body;

    if (phoneNumbers.length === 0) {
      throw badRequest("phoneNumbers array must not be empty");
    }

    // Query users whose stored phone_number matches any submitted number.
    // The caller is excluded ($2) to avoid surfacing themselves.
    // Results are capped at MAX_RESULTS to prevent bulk enumeration.
    const { rows } = await db.query<UserMatchRow>(
      `SELECT
         u.id           AS user_id,
         u.username,
         u.display_name,
         u.avatar_emoji,
         u.phone_number
       FROM users u
       WHERE u.deleted_at IS NULL
         AND u.phone_number = ANY($1::text[])
         AND u.id != $2
       LIMIT $3`,
      [phoneNumbers, callerId, MAX_RESULTS]
    );

    const contacts: ZobiaContactResult[] = rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name ?? row.username,
      avatarEmoji: row.avatar_emoji ?? "👤",
      phoneNumber: "[matched]",
    }));

    return NextResponse.json({ contacts });
  } catch (err) {
    return handleApiError(err);
  }
});
