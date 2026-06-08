export const dynamic = 'force-dynamic';

/**
 * app/api/seasons/current/route.ts
 *
 * GET /api/seasons/current
 *
 * Returns the currently active season with:
 *  - Season metadata (theme, start/end, phase)
 *  - The calling user's season pass (if any)
 *  - Top 3 leaderboard preview
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { getCurrentSeason, getSeasonPhase, isSeasonActive } from "@/lib/seasons/seasonEngine";

// ---------------------------------------------------------------------------
// GET /api/seasons/current
// ---------------------------------------------------------------------------

/**
 * Returns the active season with user's season pass status and leaderboard preview.
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const season = await getCurrentSeason(db);
    if (!season) throw notFound("No active season");

    // User's season pass
    const passResult = await db.query<{
      id: string;
      is_paid: boolean;
      season_xp: number;
      season_rank: number | null;
      purchased_at: string | null;
    }>(
      `SELECT id, is_paid, season_xp, season_rank, purchased_at
       FROM user_season_passes
       WHERE user_id = $1 AND season_id = $2
       LIMIT 1`,
      [auth.user.sub, season.id]
    );

    // Top 3 preview
    const top3Result = await db.query<{
      user_id: string;
      username: string;
      avatar_emoji: string;
      rank_name: string;
      season_xp: number;
    }>(
      `SELECT usp.user_id, u.username, u.avatar_emoji, u.rank_name, usp.season_xp
       FROM user_season_passes usp
       JOIN users u ON u.id = usp.user_id
       WHERE usp.season_id = $1
       ORDER BY usp.season_xp DESC
       LIMIT 3`,
      [season.id]
    );

    return NextResponse.json({
      success: true,
      data: {
        season: {
          ...season,
          phase: getSeasonPhase(season),
          isActive: isSeasonActive(season),
          secondsRemaining: Math.max(
            0,
            Math.floor((new Date(season.ends_at).getTime() - Date.now()) / 1000)
          ),
        },
        userPass: passResult.rows[0] ?? null,
        leaderboardPreview: top3Result.rows,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
