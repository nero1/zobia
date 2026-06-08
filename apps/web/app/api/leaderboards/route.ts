export const dynamic = 'force-dynamic';

/**
 * app/api/leaderboards/route.ts
 *
 * GET /api/leaderboards
 *
 * Paginated leaderboard endpoint.
 *
 * Query params:
 *   - scope : 'global' | 'city' | 'guild' | 'season'  (default: 'global')
 *   - track : 'main' | 'social' | 'creator' | 'competitor' | 'generosity' | 'knowledge' | 'explorer'
 *             (default: 'main')
 *   - city  : string — required when scope = 'city' (falls back to user's city)
 *   - limit : number (default: 100, max: 200)
 *   - page  : page number, 1-indexed (default: 1)
 *
 * Returns paginated leaderboard entries with the calling user's rank position.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import {
  getLeaderboard,
  getUserRank,
  type LeaderboardScope,
  type LeaderboardTrack,
} from "@/lib/leaderboards/engine";

// ---------------------------------------------------------------------------
// Valid values
// ---------------------------------------------------------------------------

const VALID_SCOPES: LeaderboardScope[] = ["global", "national", "city", "guild", "season"];
const VALID_TRACKS: LeaderboardTrack[] = [
  "main",
  "social",
  "creator",
  "competitor",
  "generosity",
  "knowledge",
  "explorer",
];

// ---------------------------------------------------------------------------
// GET /api/leaderboards
// ---------------------------------------------------------------------------

/**
 * Returns a paginated leaderboard for the requested track and scope.
 * The calling user's rank is always returned regardless of their position on the page.
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(req.url);
    const scopeParam = searchParams.get("scope") ?? "global";
    const trackParam = searchParams.get("track") ?? "main";
    const cityParam = searchParams.get("city");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200);
    const page = Math.max(parseInt(searchParams.get("page") ?? "1"), 1);

    const scope: LeaderboardScope = VALID_SCOPES.includes(scopeParam as LeaderboardScope)
      ? (scopeParam as LeaderboardScope)
      : "global";

    const track: LeaderboardTrack = VALID_TRACKS.includes(trackParam as LeaderboardTrack)
      ? (trackParam as LeaderboardTrack)
      : "main";

    // Resolve city — use param, fall back to user's city
    let city: string | null = cityParam;
    if (scope === "city" && !city) {
      const userResult = await db.query<{ city: string | null }>(
        `SELECT city FROM users WHERE id = $1`,
        [auth.user.sub]
      );
      city = userResult.rows[0]?.city ?? null;
    }

    // Resolve guild
    let guildId: string | null = null;
    if (scope === "guild") {
      const userResult = await db.query<{ guild_id: string | null }>(
        `SELECT guild_id FROM users WHERE id = $1`,
        [auth.user.sub]
      );
      guildId = userResult.rows[0]?.guild_id ?? null;
    }

    // Resolve season
    let seasonId: string | null = null;
    if (scope === "season") {
      const seasonResult = await db.query<{ id: string }>(
        `SELECT id FROM seasons WHERE is_active = TRUE AND ends_at > NOW() LIMIT 1`,
        []
      );
      seasonId = seasonResult.rows[0]?.id ?? null;
    }

    const leaderboardPage = await getLeaderboard(track, scope, city, page, db, {
      pageSize: limit,
      guildId: guildId ?? undefined,
      seasonId: seasonId ?? undefined,
    });

    const userRank = await getUserRank(auth.user.sub, track, scope, db, {
      city: city ?? undefined,
      guildId: guildId ?? undefined,
      seasonId: seasonId ?? undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...leaderboardPage,
        userRank,
        scope,
        track,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
