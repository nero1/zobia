export const dynamic = "force-dynamic";

/**
 * GET /api/games/<slug>/my-rating
 *
 * Returns the authenticated user's current rating for a game (if any) and
 * whether they have played the game at least once (the prerequisite for rating).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { assertGamesEnabled } from "@/lib/games/config";
import { getActiveGameBySlug } from "@/lib/games/repo";
import { db } from "@/lib/db";

export const GET = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { slug: string }; auth: { user: { sub: string } } }) => {
    try {
      await assertGamesEnabled();

      const game = await getActiveGameBySlug(params.slug);
      if (!game) throw notFound("Game not found.");

      const [ratingResult, playResult] = await Promise.all([
        db.query<{ rating: number }>(
          `SELECT rating FROM game_ratings WHERE game_id = $1 AND user_id = $2 LIMIT 1`,
          [game.id, auth.user.sub]
        ),
        db.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM game_best_scores WHERE game_id = $1 AND user_id = $2) AS exists`,
          [game.id, auth.user.sub]
        ),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          yourRating: ratingResult.rows[0]?.rating ?? null,
          hasPlayed: playResult.rows[0]?.exists ?? false,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
