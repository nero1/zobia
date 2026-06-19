export const dynamic = "force-dynamic";

/**
 * app/api/games/<slug>/leaderboard
 *
 * GET — top high scores for a game (cached). ?page=N (1-based).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getActiveGameBySlug } from "@/lib/games/repo";
import { getGameLeaderboard } from "@/lib/games/leaderboard";

export const GET = withAuth(
  async (req: NextRequest, { params, auth }: { params: { slug: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
      await assertGamesEnabled();

      const game = await getActiveGameBySlug(params.slug);
      if (!game) throw notFound("Game not found.");

      const page = Number(new URL(req.url).searchParams.get("page") ?? "1") || 1;
      const board = await getGameLeaderboard(game.id, page);
      return NextResponse.json({ success: true, data: board, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
