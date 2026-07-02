export const dynamic = "force-dynamic";

/**
 * app/api/games/recent/route.ts
 *
 * GET /api/games/recent — "Recently Played" discovery tab. Backed by the
 * existing game_plays table (no new table needed — every /start already
 * writes a row here), grouped to the most recent session per game.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { listRecentlyPlayedGames } from "@/lib/games/repo";

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 24)),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await assertGamesEnabled();
    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const result = await listRecentlyPlayedGames(auth.user.sub, query.cursor, query.limit);
    return NextResponse.json({
      success: true,
      data: { games: result.games, nextCursor: result.nextCursor, hasMore: result.hasMore },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
