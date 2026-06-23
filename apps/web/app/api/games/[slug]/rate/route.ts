export const dynamic = "force-dynamic";

/**
 * POST /api/games/<slug>/rate
 *
 * Upsert a 1-5 star rating for a game. Logged-in users only, once per game
 * (subsequent calls update the rating). Returns updated avg + count.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { db } from "@/lib/db";
import { getActiveGameBySlug, upsertGameRating } from "@/lib/games/repo";

export const POST = withAuth(
  async (req: NextRequest, { params, auth }: { params: { slug: string }; auth: { user: { sub: string } } }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
      await assertGamesEnabled();

      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw badRequest("Rating must be an integer between 1 and 5.");
      }

      const game = await getActiveGameBySlug(params.slug);
      if (!game) throw notFound("Game not found.");

      // Enforce play-gate: user must have played at least once.
      const { rows: playRows } = await db.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM game_best_scores WHERE game_id = $1 AND user_id = $2) AS exists`,
        [game.id, auth.user.sub]
      );
      if (!playRows[0]?.exists) {
        throw badRequest("You must play this game at least once before rating it.");
      }

      const result = await upsertGameRating(game.id, auth.user.sub, rating as 1 | 2 | 3 | 4 | 5);

      return NextResponse.json({
        success: true,
        data: { avgRating: result.avgRating, ratingCount: result.ratingCount, yourRating: rating },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
