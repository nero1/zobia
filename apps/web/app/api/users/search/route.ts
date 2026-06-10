export const dynamic = 'force-dynamic';

/**
 * app/api/users/search/route.ts
 *
 * GET /api/users/search?q=<term>
 *
 * Searches users by username prefix.
 * Used by gifting UIs, DM targeting, and user-to-user features.
 *
 * Returns up to 10 users matching the query (min 2 chars).
 * Excludes the requesting user from results.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  is_friend: boolean;
}

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";

    if (q.length < 2) {
      throw badRequest("Search query must be at least 2 characters");
    }

    const userId = auth.user.sub;

    const { rows } = await db.query<UserRow>(
      `SELECT
         u.id, u.username, u.display_name, u.avatar_emoji,
         EXISTS (
           SELECT 1 FROM friendships f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = $2 AND f.addressee_id = u.id)
               OR (f.addressee_id = $2 AND f.requester_id = u.id))
         ) AS is_friend
       FROM users u
       WHERE (u.username ILIKE $1 OR u.display_name ILIKE $3)
         AND u.deleted_at IS NULL
         AND u.id != $2
       ORDER BY
         CASE WHEN u.username ILIKE $1 THEN 0 ELSE 1 END,
         u.username
       LIMIT 20`,
      [`${q}%`, userId, `%${q}%`]
    );

    return NextResponse.json({
      success: true,
      data: {
        users: rows.map((r) => ({
          id: r.id,
          username: r.username,
          displayName: r.display_name ?? r.username,
          avatarEmoji: r.avatar_emoji,
          isFriend: r.is_friend,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
