export const dynamic = "force-dynamic";

/**
 * POST /api/games/challenges/<id>/play
 *
 * Open a play session for the caller's current active round in a challenge.
 * Returns the nonce + the game slug to load; the normal /api/games/<slug>/score
 * endpoint finalizes the round (it routes via the play's challenge_round_id).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { prepareChallengeRoundPlay } from "@/lib/games/challenges";
import { startPlaySession } from "@/lib/games/sessions";

export const POST = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { id: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.gameStart);
      await assertGamesEnabled();

      const { game, roundId } = await prepareChallengeRoundPlay(params.id, auth.user.sub);
      const session = await startPlaySession(auth.user.sub, game, roundId);

      return NextResponse.json({
        success: true,
        data: { ...session, gameSlug: game.slug, gameName: game.name, engineKey: game.engine_key },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
