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
}

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";

    if (q.length < 2) {
      throw badRequest("Search query must be at least 2 characters");
    }

    const { rows } = await db.query<UserRow>(
      `SELECT id, username, display_name, avatar_emoji
       FROM users
       WHERE username ILIKE $1
         AND deleted_at IS NULL
         AND id != $2
       ORDER BY username
       LIMIT 10`,
      [`${q}%`, auth.user.sub]
    );

    return NextResponse.json({
      success: true,
      data: {
        users: rows.map((r) => ({
          id: r.id,
          username: r.username,
          displayName: r.display_name ?? r.username,
          avatarEmoji: r.avatar_emoji,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
