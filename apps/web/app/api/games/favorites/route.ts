export const dynamic = "force-dynamic";

/**
 * app/api/games/favorites/route.ts
 *
 * Game favorites — the "❤️ Faves" heart toggle on the games discovery page.
 * Mirrors /api/rooms/pinned (room_pins), minus the plan-tiered limit: games
 * favoriting is a discovery aid, not a scarce resource, so it's unlimited.
 *
 * GET    /api/games/favorites          – list the user's favorited games
 * POST   /api/games/favorites          – favorite a game   { gameId }
 * DELETE /api/games/favorites          – unfavorite a game { gameId }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { listFavoriteGames, setGameFavorite, getGameById } from "@/lib/games/repo";

const favoriteSchema = z.object({
  gameId: z.string().uuid("gameId must be a valid UUID"),
});

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
    const result = await listFavoriteGames(auth.user.sub, query.cursor, query.limit);
    return NextResponse.json({
      success: true,
      data: { games: result.games, nextCursor: result.nextCursor, hasMore: result.hasMore },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await assertGamesEnabled();
    const body = await validateBody(req, favoriteSchema);
    const game = await getGameById(body.gameId);
    if (!game) throw notFound("Game not found.");
    const result = await setGameFavorite(auth.user.sub, body.gameId, true);
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await assertGamesEnabled();
    const body = await validateBody(req, favoriteSchema);
    const result = await setGameFavorite(auth.user.sub, body.gameId, false);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
