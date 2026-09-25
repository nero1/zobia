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
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import {
  getLeaderboard,
  getUserRank,
  type LeaderboardScope,
  type LeaderboardTrack,
  type LeaderboardCursor,
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
  "gaming",
];

// ---------------------------------------------------------------------------
// GET /api/leaderboards
// ---------------------------------------------------------------------------

/**
 * Returns a paginated leaderboard for the requested track and scope.
 * The calling user's rank is always returned regardless of their position on the page.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { searchParams } = new URL(req.url);
    const scopeParam = searchParams.get("scope") ?? "global";
    const trackParam = searchParams.get("track") ?? "main";
    const cityParam = searchParams.get("city");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200);
    const page = Math.max(parseInt(searchParams.get("page") ?? "1"), 1);

    // Cursor-based pagination: cursor={xpValue}:{userId} — supersedes page if provided
    let cursor: LeaderboardCursor | null = null;
    const cursorParam = searchParams.get("cursor");
    if (cursorParam) {
      const [xpStr, userId] = cursorParam.split(":");
      const xpValue = parseInt(xpStr, 10);
      if (!isNaN(xpValue) && userId) {
        cursor = { xpValue, userId };
      }
    }

    const scope: LeaderboardScope = VALID_SCOPES.includes(scopeParam as LeaderboardScope)
      ? (scopeParam as LeaderboardScope)
      : "global";

    const track: LeaderboardTrack = VALID_TRACKS.includes(trackParam as LeaderboardTrack)
      ? (trackParam as LeaderboardTrack)
      : "main";

    const orm = await getDb();

    // Resolve user profile fields needed for scope-specific filtering
    const [userProfile] = await orm
      .select({ city: schema.users.city, guildId: schema.users.guildId, country: schema.users.country })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub));

    // Resolve city — use param, fall back to user's city
    let city: string | null = cityParam;
    if (scope === "city" && !city) {
      city = userProfile?.city ?? null;
    }

    // Resolve country for national leaderboard
    const country: string = userProfile?.country ?? 'NG';

    // Resolve guild
    let guildId: string | null = null;
    if (scope === "guild") {
      guildId = userProfile?.guildId ?? null;
    }

    // Resolve season
    let seasonId: string | null = null;
    if (scope === "season") {
      const [season] = await orm
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(and(eq(schema.seasons.isActive, true), gt(schema.seasons.endsAt, new Date())))
        .limit(1);
      seasonId = season?.id ?? null;
    }

    const leaderboardPage = await getLeaderboard(track, scope, city, page, orm, {
      pageSize: limit,
      guildId: guildId ?? undefined,
      seasonId: seasonId ?? undefined,
      country,
      cursor,
    });

    const userRank = await getUserRank(auth.user.sub, track, scope, orm, {
      city: city ?? undefined,
      guildId: guildId ?? undefined,
      seasonId: seasonId ?? undefined,
      country,
    });

    // The Plan column exposes another user's subscription tier — only
    // Moderator/Admin requesters get it back. Re-checked fresh from the DB
    // (never trusted from the JWT claim), same pattern as withAdminAuth.
    const [roleRow] = await orm
      .select({ isAdmin: schema.users.isAdmin, isModerator: schema.users.isModerator })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub));
    const canSeePlan = Boolean(roleRow?.isAdmin || roleRow?.isModerator);
    const entries = canSeePlan
      ? leaderboardPage.entries
      : leaderboardPage.entries.map(({ plan: _plan, ...rest }) => rest);

    return NextResponse.json({
      success: true,
      data: {
        ...leaderboardPage,
        entries,
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
