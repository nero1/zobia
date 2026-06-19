export const dynamic = "force-dynamic";

/**
 * app/api/games/route.ts
 *
 * GET /api/games — paginated, filterable game discovery list.
 *
 * Query params:
 *   tab      — "new" | "popular" (default) | "trending"
 *   category — filter by category slug
 *   free     — "true" | "false" for free/paid filter
 *   cursor   — opaque cursor for pagination (ISO timestamp)
 *   limit    — max items per page (default 24, max 50)
 *
 * Also returns byCategory grouping for the initial (no-filter) view.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { listGames, getActiveGames } from "@/lib/games/repo";
import { GAME_CATEGORIES } from "@zobia/types";

export const GET = withAuth(async (req: NextRequest, { auth }: { auth: { user: { sub: string } } }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await assertGamesEnabled();

    const sp = req.nextUrl.searchParams;
    const tab = (sp.get("tab") ?? "popular") as "new" | "popular" | "trending";
    const category = sp.get("category") ?? undefined;
    const freeParam = sp.get("free");
    const free = freeParam === "true" ? true : freeParam === "false" ? false : undefined;
    const cursor = sp.get("cursor") ?? undefined;
    const limit = Math.min(Number(sp.get("limit") ?? 24), 50);

    const isFiltered = !!(tab !== "popular" || category || freeParam || cursor);

    if (!isFiltered) {
      // Initial load: return full game list + byCategory grouping (backwards-compat)
      const games = await getActiveGames();
      const byCategory = GAME_CATEGORIES.map((cat) => ({
        category: cat,
        games: games.filter((g) => g.category === cat),
      })).filter((group) => group.games.length > 0);

      const uncategorised = games.filter((g) => !g.category);
      if (uncategorised.length > 0) {
        byCategory.push({ category: "Other" as never, games: uncategorised });
      }

      return NextResponse.json({
        success: true,
        data: { categories: byCategory, games, nextCursor: null, hasMore: false },
        error: null,
      });
    }

    const result = await listGames({ tab, category, free, cursor, limit });
    return NextResponse.json({
      success: true,
      data: { games: result.games, nextCursor: result.nextCursor, hasMore: result.hasMore, categories: null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
