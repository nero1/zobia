export const dynamic = "force-dynamic";

/**
 * POST /api/games/<slug>/rate
 *
 * Upsert a 1-5 star rating for a game. Logged-in users only, once per game
 * (subsequent calls update the rating). Returns updated avg + count.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();
      const playRows = await orm
        .select({ gameId: schema.gameBestScores.gameId })
        .from(schema.gameBestScores)
        .where(and(eq(schema.gameBestScores.gameId, game.id), eq(schema.gameBestScores.userId, auth.user.sub)))
        .limit(1);
      if (playRows.length === 0) {
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
