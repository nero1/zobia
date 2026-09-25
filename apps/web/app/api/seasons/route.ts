export const dynamic = 'force-dynamic';

/**
 * app/api/seasons/route.ts
 *
 * Season listing endpoints.
 *
 * GET /api/seasons
 *   - Returns the current active season and a history of past seasons.
 *
 * GET /api/seasons/current
 *   - Returns the active season with detailed stats.
 *   - Handled in /api/seasons/current/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { or, eq, lte, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getCurrentSeason, isSeasonActive, getSeasonPhase } from "@/lib/seasons/seasonEngine";

// ---------------------------------------------------------------------------
// GET /api/seasons
// ---------------------------------------------------------------------------

/**
 * Returns the current season (if any) and the 10 most recent past seasons.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const orm = await getDb();
    const current = await getCurrentSeason(orm);

    const pastRows = await orm
      .select({
        id: schema.seasons.id,
        name: schema.seasons.name,
        theme: schema.seasons.theme,
        startsAt: schema.seasons.startsAt,
        endsAt: schema.seasons.endsAt,
        isActive: schema.seasons.isActive,
        passPriceCoins: schema.seasons.passPriceCoins,
        rewardPoolCoins: schema.seasons.rewardPoolCoins,
        createdAt: schema.seasons.createdAt,
      })
      .from(schema.seasons)
      .where(or(eq(schema.seasons.isActive, false), lte(schema.seasons.endsAt, sql`NOW()`)))
      .orderBy(desc(schema.seasons.endsAt))
      .limit(10);

    const past = pastRows.map((row) => ({
      id: row.id,
      name: row.name,
      theme: row.theme,
      starts_at: row.startsAt,
      ends_at: row.endsAt,
      is_active: row.isActive,
      pass_price_coins: row.passPriceCoins,
      reward_pool_coins: row.rewardPoolCoins,
      created_at: row.createdAt,
    }));

    return NextResponse.json({
      success: true,
      data: {
        current: current
          ? {
              ...current,
              phase: getSeasonPhase(current),
              isActive: isSeasonActive(current),
            }
          : null,
        past,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
