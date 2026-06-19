export const dynamic = "force-dynamic";

/**
 * app/api/games/[slug]/route.ts
 *
 * GET /api/games/<slug> — public summary + config for a single live game.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getGameSummaryBySlug } from "@/lib/games/repo";

export const GET = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { slug: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
      await assertGamesEnabled();

      const game = await getGameSummaryBySlug(params.slug);
      if (!game) throw notFound("Game not found.");

      return NextResponse.json({ success: true, data: { game }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
