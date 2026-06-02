/**
 * app/api/users/me/route.ts
 *
 * Authenticated user's own profile endpoints.
 *
 * GET  /api/users/me  – Returns the full profile of the authenticated user
 * PUT  /api/users/me  – Updates display_name, bio, and/or locale
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserProfile {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  city: string | null;
  locale: string | null;
  xp_total: number;
  coin_balance: number;
  is_admin: boolean;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const updateProfileSchema = z.object({
  display_name: z
    .string()
    .min(1, "Display name cannot be empty")
    .max(50, "Display name cannot exceed 50 characters")
    .optional(),
  bio: z
    .string()
    .max(300, "Bio cannot exceed 300 characters")
    .nullable()
    .optional(),
  locale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "locale must be a valid BCP-47 language tag (e.g. 'en' or 'en-US')")
    .optional(),
});

// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------

/**
 * Return the authenticated user's full profile.
 *
 * @returns JSON UserProfile
 */
export const GET = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { rows } = await db.query<UserProfile>(
      `SELECT
         id, email, username, display_name, bio,
         avatar_url, avatar_emoji, city, locale,
         xp_total, coin_balance, is_admin,
         onboarding_completed, created_at, updated_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [auth.user.sub]
    );

    if (!rows[0]) throw notFound("User profile not found");

    return NextResponse.json({ user: rows[0] }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/me
// ---------------------------------------------------------------------------

/**
 * Update the authenticated user's mutable profile fields.
 * Only display_name, bio, and locale may be changed via this endpoint.
 *
 * @returns JSON { user: UserProfile }
 */
export const PUT = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, updateProfileSchema);

    // Build SET clause dynamically from provided fields
    const updates: string[] = [];
    const params: (string | null)[] = [];
    let paramIdx = 1;

    if (body.display_name !== undefined) {
      updates.push(`display_name = $${paramIdx++}`);
      params.push(body.display_name);
    }
    if (body.bio !== undefined) {
      updates.push(`bio = $${paramIdx++}`);
      params.push(body.bio);
    }
    if (body.locale !== undefined) {
      updates.push(`locale = $${paramIdx++}`);
      params.push(body.locale);
    }

    if (updates.length === 0) {
      // Nothing to update – return current profile
      const { rows } = await db.query<UserProfile>(
        `SELECT id, email, username, display_name, bio, avatar_url, avatar_emoji,
                city, locale, xp_total, coin_balance, is_admin,
                onboarding_completed, created_at, updated_at
         FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [auth.user.sub]
      );
      if (!rows[0]) throw notFound("User profile not found");
      return NextResponse.json({ user: rows[0] }, { status: 200 });
    }

    updates.push(`updated_at = NOW()`);
    params.push(auth.user.sub); // for WHERE clause

    const { rows } = await db.query<UserProfile>(
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE id = $${paramIdx} AND deleted_at IS NULL
       RETURNING id, email, username, display_name, bio, avatar_url, avatar_emoji,
                 city, locale, xp_total, coin_balance, is_admin,
                 onboarding_completed, created_at, updated_at`,
      params
    );

    if (!rows[0]) throw notFound("User profile not found");

    return NextResponse.json({ user: rows[0] }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
