/**
 * GET /api/creator/earnings
 *
 * Returns an earnings summary for the authenticated creator.
 * Requires the user to have `is_creator = TRUE`.
 *
 * Revenue streams included:
 *   - gifts_received:  coins received as gifts in rooms / DMs
 *   - subscriptions:   subscription plan revenues attributed to this creator
 *   - tips:            explicit tips from followers
 *
 * Amounts are returned in kobo (the stored unit) alongside a human-readable
 * NGN representation. The platform takes 20%; creator receives 80%.
 *
 * @module app/api/creator/earnings
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { forbidden, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface EarningsRow {
  stream: string;
  gross_kobo: number;
  period: "today" | "week" | "month" | "all_time";
}

interface CreatorRow {
  is_creator: boolean;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/creator/earnings
 *
 * Returns:
 * ```json
 * {
 *   "today": { "grossKobo": 0, "netKobo": 0, "platformFeeKobo": 0, "byStream": {} },
 *   "week":  { ... },
 *   "month": { ... },
 *   "allTime": { ... }
 * }
 * ```
 */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    // Verify creator status
    const { rows: creatorRows } = await db.query<CreatorRow>(
      `SELECT is_creator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!creatorRows[0]?.is_creator) {
      throw forbidden("Creator access required");
    }

    // Earnings by period — use a single query with conditional aggregation
    const { rows } = await db.query<EarningsRow>(
      `SELECT
         stream,
         SUM(gross_kobo) FILTER (WHERE created_at >= CURRENT_DATE)::BIGINT AS today_gross,
         SUM(gross_kobo) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::BIGINT AS week_gross,
         SUM(gross_kobo) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::BIGINT AS month_gross,
         SUM(gross_kobo)::BIGINT AS all_time_gross
       FROM creator_earnings
       WHERE creator_id = $1
       GROUP BY stream`,
      [userId]
    );

    // Platform fee: 20%; creator net: 80%
    const PLATFORM_FEE_PERCENT = 20;
    const CREATOR_PERCENT = 80;

    function buildPeriodSummary(grossKobo: number) {
      const platformFeeKobo = Math.floor((grossKobo * PLATFORM_FEE_PERCENT) / 100);
      const netKobo = Math.floor((grossKobo * CREATOR_PERCENT) / 100);
      return { grossKobo, netKobo, platformFeeKobo };
    }

    // Aggregate per period
    const periods: Record<string, { grossKobo: number; byStream: Record<string, number> }> = {
      today: { grossKobo: 0, byStream: {} },
      week: { grossKobo: 0, byStream: {} },
      month: { grossKobo: 0, byStream: {} },
      allTime: { grossKobo: 0, byStream: {} },
    };

    for (const row of rows as unknown as Array<{
      stream: string;
      today_gross: string;
      week_gross: string;
      month_gross: string;
      all_time_gross: string;
    }>) {
      const todayGross = parseInt(row.today_gross ?? "0", 10);
      const weekGross = parseInt(row.week_gross ?? "0", 10);
      const monthGross = parseInt(row.month_gross ?? "0", 10);
      const allTimeGross = parseInt(row.all_time_gross ?? "0", 10);

      periods.today.grossKobo += todayGross;
      periods.today.byStream[row.stream] = todayGross;

      periods.week.grossKobo += weekGross;
      periods.week.byStream[row.stream] = weekGross;

      periods.month.grossKobo += monthGross;
      periods.month.byStream[row.stream] = monthGross;

      periods.allTime.grossKobo += allTimeGross;
      periods.allTime.byStream[row.stream] = allTimeGross;
    }

    return NextResponse.json({
      today: { ...buildPeriodSummary(periods.today.grossKobo), byStream: periods.today.byStream },
      week: { ...buildPeriodSummary(periods.week.grossKobo), byStream: periods.week.byStream },
      month: { ...buildPeriodSummary(periods.month.grossKobo), byStream: periods.month.byStream },
      allTime: { ...buildPeriodSummary(periods.allTime.grossKobo), byStream: periods.allTime.byStream },
      platformFeePercent: PLATFORM_FEE_PERCENT,
      creatorSharePercent: CREATOR_PERCENT,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
