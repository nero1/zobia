export const dynamic = "force-dynamic";

/**
 * app/api/games/<slug>/score
 *
 * POST — finalize a reported score for a started session. Validates the score,
 * records the play, grants win rewards, updates the leaderboard and advances a
 * challenge round when the play is bound to one.
 *
 * Body: { nonce: string, score: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getActiveGameBySlug } from "@/lib/games/repo";
import { finalizeScore } from "@/lib/games/sessions";

const scoreSchema = z.object({
  nonce: z.string().uuid(),
  score: z.number().int().nonnegative().max(1_000_000_000),
});

export const POST = withAuth(
  async (req: NextRequest, { params, auth }: { params: { slug: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.gameScore);
      await assertGamesEnabled();

      const body = await validateBody(req, scoreSchema);
      const game = await getActiveGameBySlug(params.slug);
      if (!game) throw notFound("Game not found.");

      const result = await finalizeScore(auth.user.sub, body.nonce, body.score, game);
      return NextResponse.json({ success: true, data: result, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
