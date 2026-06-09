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
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getCurrentSeason, isSeasonActive, getSeasonPhase } from "@/lib/seasons/seasonEngine";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SeasonRow {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
  reward_pool_coins: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/seasons
// ---------------------------------------------------------------------------

/**
 * Returns the current season (if any) and the 10 most recent past seasons.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const current = await getCurrentSeason(db);

    const { rows: past } = await db.query<SeasonRow>(
      `SELECT id, name, theme, starts_at, ends_at, is_active,
              pass_price_coins, reward_pool_coins, created_at
       FROM seasons
       WHERE is_active = FALSE OR ends_at <= NOW()
       ORDER BY ends_at DESC
       LIMIT 10`,
      []
    );

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
