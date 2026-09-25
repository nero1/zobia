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
import { and, eq, desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { getCurrentSeason, getSeasonPhase, isSeasonActive } from "@/lib/seasons/seasonEngine";

// ---------------------------------------------------------------------------
// GET /api/seasons/current
// ---------------------------------------------------------------------------

/**
 * Returns the active season with user's season pass status and leaderboard preview.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const orm = await getDb();
    const season = await getCurrentSeason(orm);
    if (!season) throw notFound("No active season");

    // User's season pass
    const [pass] = await orm
      .select({
        id: schema.userSeasonPasses.id,
        isPaid: schema.userSeasonPasses.isPaid,
        seasonXp: schema.userSeasonPasses.seasonXp,
        seasonRank: schema.userSeasonPasses.seasonRank,
        purchasedAt: schema.userSeasonPasses.purchasedAt,
      })
      .from(schema.userSeasonPasses)
      .where(and(eq(schema.userSeasonPasses.userId, auth.user.sub), eq(schema.userSeasonPasses.seasonId, season.id)))
      .limit(1);

    // Top 3 preview
    const top3Rows = await orm
      .select({
        userId: schema.userSeasonPasses.userId,
        username: schema.users.username,
        avatarEmoji: schema.users.avatarEmoji,
        rankName: schema.users.rankName,
        seasonXp: schema.userSeasonPasses.seasonXp,
      })
      .from(schema.userSeasonPasses)
      .innerJoin(schema.users, eq(schema.users.id, schema.userSeasonPasses.userId))
      .where(eq(schema.userSeasonPasses.seasonId, season.id))
      .orderBy(desc(schema.userSeasonPasses.seasonXp))
      .limit(3);

    const response = NextResponse.json({
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
        userPass: pass
          ? {
              id: pass.id,
              is_paid: pass.isPaid,
              season_xp: Number(pass.seasonXp),
              season_rank: pass.seasonRank,
              purchased_at: pass.purchasedAt,
            }
          : null,
        leaderboardPreview: top3Rows.map((r) => ({
          user_id: r.userId,
          username: r.username,
          avatar_emoji: r.avatarEmoji,
          rank_name: r.rankName,
          season_xp: Number(r.seasonXp),
        })),
      },
      error: null,
    });
    response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return response;
  } catch (err) {
    return handleApiError(err);
  }
});
