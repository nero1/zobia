export const dynamic = "force-dynamic";

/**
 * app/api/games/route.ts
 *
 * GET /api/games — active games for the directory, grouped by category.
 * Requires the games feature to be enabled.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getActiveGames } from "@/lib/games/repo";
import { GAME_CATEGORIES } from "@zobia/types";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await assertGamesEnabled();

    const games = await getActiveGames();
    const byCategory = GAME_CATEGORIES.map((category) => ({
      category,
      games: games.filter((g) => g.category === category),
    })).filter((group) => group.games.length > 0);

    // Uncategorised games (defensive) appended last.
    const uncategorised = games.filter((g) => !g.category);
    if (uncategorised.length > 0) {
      byCategory.push({ category: "Other" as never, games: uncategorised });
    }

    return NextResponse.json({ success: true, data: { categories: byCategory, games }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
