export const dynamic = 'force-dynamic';

/**
 * app/api/leaderboards/me/route.ts
 *
 * GET /api/leaderboards/me
 *
 * Returns the calling user's rank position on every leaderboard track
 * for all scopes (global, city, guild if in one, current season if active).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getUserRank, type LeaderboardTrack } from "@/lib/leaderboards/engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_TRACKS: LeaderboardTrack[] = [
  "main",
  "social",
  "creator",
  "competitor",
  "generosity",
  "knowledge",
  "explorer",
];

// ---------------------------------------------------------------------------
// GET /api/leaderboards/me
// ---------------------------------------------------------------------------

/**
 * Returns the user's rank on every track across all applicable scopes.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    // Fetch user context (city, guild)
    const userResult = await db.query<{ city: string | null; guild_id: string | null }>(
      `SELECT city, guild_id FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    const user = userResult.rows[0];
    const city = user?.city ?? null;
    const guildId = user?.guild_id ?? null;

    // Active season
    const seasonResult = await db.query<{ id: string }>(
      `SELECT id FROM seasons WHERE is_active = TRUE AND ends_at > NOW() LIMIT 1`,
      []
    );
    const seasonId = seasonResult.rows[0]?.id ?? null;

    // Fetch ranks across all tracks in parallel
    const rankPromises = ALL_TRACKS.map(async (track) => {
      const [globalRank, cityRank, guildRank, seasonRank] = await Promise.all([
        getUserRank(userId, track, "global", db),
        city ? getUserRank(userId, track, "city", db, { city }) : Promise.resolve(null),
        guildId ? getUserRank(userId, track, "guild", db, { guildId }) : Promise.resolve(null),
        seasonId ? getUserRank(userId, track, "season", db, { seasonId }) : Promise.resolve(null),
      ]);

      return {
        track,
        globalRank,
        cityRank,
        guildRank,
        seasonRank,
      };
    });

    const ranks = await Promise.all(rankPromises);

    return NextResponse.json({
      success: true,
      data: {
        userId,
        city,
        guildId,
        seasonId,
        ranks,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
