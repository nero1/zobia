/**
 * app/api/users/[userId]/route.ts
 *
 * Public user profile endpoint.
 *
 * GET /api/users/[userId]
 *   Returns the public profile of any user by their UUID.
 *   Private fields (email, coin_balance, is_admin) are never exposed here.
 *   Requires authentication to prevent unauthenticated scraping.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PublicUserProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  city: string | null;
  xp_total: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Route params type
// ---------------------------------------------------------------------------

interface UserParams {
  userId: string;
}

// ---------------------------------------------------------------------------
// GET /api/users/[userId]
// ---------------------------------------------------------------------------

/**
 * Return the public profile of any user by their UUID.
 *
 * Private fields (email, coin_balance, is_admin, etc.) are excluded.
 * Only users who have completed onboarding are returned – incomplete profiles
 * are treated as not found to prevent data leakage.
 *
 * @returns JSON { user: PublicUserProfile }
 */
export const GET = withAuth<UserParams>(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { userId } = params;

    // Basic UUID format validation
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(userId)) {
      throw badRequest("userId must be a valid UUID");
    }

    const { rows } = await db.query<PublicUserProfile>(
      `SELECT
         id, username, display_name, bio,
         avatar_url, avatar_emoji, city, xp_total, created_at
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL
         AND onboarding_completed = true
         AND is_suspended = false
       LIMIT 1`,
      [userId]
    );

    if (!rows[0]) throw notFound("User not found");

    return NextResponse.json({ user: rows[0] }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
