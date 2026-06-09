export const dynamic = 'force-dynamic';

/**
 * app/api/admin/leaderboards/route.ts
 *
 * GET /api/admin/leaderboards
 *   Returns the current season leaderboard (top 50 by season_xp).
 *   Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";

interface LeaderboardRow {
  rank: number;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
  season_xp: number;
  prestige_count: number | null;
  is_suspended: boolean;
}

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    // Verify caller is admin
    const { rows: adminRows } = await db.query<{ is_admin: boolean }>(
      `SELECT COALESCE(is_admin, false) AS is_admin FROM users WHERE id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    if (!adminRows[0]?.is_admin) return forbidden("Admin access required");

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    const { rows } = await db.query<LeaderboardRow>(
      `SELECT
         ROW_NUMBER() OVER (ORDER BY COALESCE(season_xp, 0) DESC) AS rank,
         id AS user_id,
         username,
         display_name,
         avatar_emoji,
         COALESCE(season_xp, 0)::int AS season_xp,
         prestige_count,
         COALESCE(is_suspended, false) AS is_suspended
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY season_xp DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return NextResponse.json({ success: true, data: { entries: rows, limit, offset } });
  } catch (err) {
    return handleApiError(err);
  }
});
