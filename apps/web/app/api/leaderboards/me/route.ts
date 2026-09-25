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
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
    const orm = await getDb();

    // Fetch user context (city, guild)
    const [user] = await orm
      .select({ city: schema.users.city, guildId: schema.users.guildId })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)));
    const city = user?.city ?? null;
    const guildId = user?.guildId ?? null;

    // Active season
    const [season] = await orm
      .select({ id: schema.seasons.id })
      .from(schema.seasons)
      .where(and(eq(schema.seasons.isActive, true), gt(schema.seasons.endsAt, new Date())))
      .limit(1);
    const seasonId = season?.id ?? null;

    // Fetch ranks across all tracks in parallel
    const rankPromises = ALL_TRACKS.map(async (track) => {
      const [globalRank, cityRank, guildRank, seasonRank] = await Promise.all([
        getUserRank(userId, track, "global", orm),
        city ? getUserRank(userId, track, "city", orm, { city }) : Promise.resolve(null),
        guildId ? getUserRank(userId, track, "guild", orm, { guildId }) : Promise.resolve(null),
        seasonId ? getUserRank(userId, track, "season", orm, { seasonId }) : Promise.resolve(null),
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
