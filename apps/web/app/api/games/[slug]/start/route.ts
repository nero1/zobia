export const dynamic = "force-dynamic";

/**
 * app/api/games/<slug>/start
 *
 * POST — open a solo play session. Charges any per-play cost (credits/stars)
 * and returns a single-use nonce the client echoes back to /score.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getActiveGameBySlug } from "@/lib/games/repo";
import { startPlaySession } from "@/lib/games/sessions";

export const POST = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { slug: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.gameStart);
      await assertGamesEnabled();

      const game = await getActiveGameBySlug(params.slug);
      if (!game) throw notFound("Game not found.");

      const session = await startPlaySession(auth.user.sub, game);
      return NextResponse.json({ success: true, data: session, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
