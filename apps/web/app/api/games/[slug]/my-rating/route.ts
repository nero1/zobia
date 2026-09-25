export const dynamic = "force-dynamic";

/**
 * GET /api/games/<slug>/my-rating
 *
 * Returns the authenticated user's current rating for a game (if any) and
 * whether they have played the game at least once (the prerequisite for rating).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { assertGamesEnabled } from "@/lib/games/config";
import { getActiveGameBySlug } from "@/lib/games/repo";
import { getDb, schema } from "@/lib/db/drizzle";

export const GET = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { slug: string }; auth: { user: { sub: string } } }) => {
    try {
      await assertGamesEnabled();

      const game = await getActiveGameBySlug(params.slug);
      if (!game) throw notFound("Game not found.");

      const orm = await getDb();
      const [ratingRows, playRows] = await Promise.all([
        orm
          .select({ rating: schema.gameRatings.rating })
          .from(schema.gameRatings)
          .where(and(eq(schema.gameRatings.gameId, game.id), eq(schema.gameRatings.userId, auth.user.sub)))
          .limit(1),
        orm
          .select({ gameId: schema.gameBestScores.gameId })
          .from(schema.gameBestScores)
          .where(and(eq(schema.gameBestScores.gameId, game.id), eq(schema.gameBestScores.userId, auth.user.sub)))
          .limit(1),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          yourRating: ratingRows[0]?.rating ?? null,
          hasPlayed: playRows.length > 0,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
