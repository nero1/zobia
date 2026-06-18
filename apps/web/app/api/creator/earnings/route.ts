export const dynamic = 'force-dynamic';

/**
 * GET /api/creator/earnings
 *
 * Returns an earnings summary for the authenticated creator.
 * Requires the user to have `is_creator = TRUE`.
 *
 * Revenue streams included:
 *   - gifts_received:   coins received as gifts in rooms / DMs
 *   - subscriptions:    subscription plan revenues attributed to this creator
 *   - tips:             explicit tips from followers
 *   - sponsored_quest:  sponsored quest payouts (70/30 split — creator 70%, platform 30%)
 *
 * Amounts are returned in kobo (the stored unit) alongside a human-readable
 * NGN representation. Standard streams take 20% platform fee (creator 80%).
 * Sponsored quest streams take 30% platform fee (creator 70%).
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
      const emptyPeriod = { grossKobo: 0, netKobo: 0, platformFeeKobo: 0, byStream: {}, byStreamNet: {} };
      return NextResponse.json({
        isCreator: false,
        today: emptyPeriod,
        week: emptyPeriod,
        month: emptyPeriod,
        allTime: emptyPeriod,
        platformFeePercent: 20,
        creatorSharePercent: 80,
        sponsoredQuestPlatformFeePercent: 30,
        sponsoredQuestCreatorSharePercent: 70,
      });
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

    // Standard streams: platform 20%, creator 80%.
    // Sponsored quest stream: platform 30%, creator 70% (PRD §Sponsored Quests).
    const STANDARD_PLATFORM_FEE_PERCENT = 20;
    const STANDARD_CREATOR_PERCENT = 80;
    const SPONSORED_QUEST_PLATFORM_FEE_PERCENT = 30;
    const SPONSORED_QUEST_CREATOR_PERCENT = 70;

    /** Returns the split percentages for a given earnings stream. */
    function splitForStream(stream: string): { creatorPct: number; platformPct: number } {
      if (stream === "sponsored_quest") {
        return { creatorPct: SPONSORED_QUEST_CREATOR_PERCENT, platformPct: SPONSORED_QUEST_PLATFORM_FEE_PERCENT };
      }
      return { creatorPct: STANDARD_CREATOR_PERCENT, platformPct: STANDARD_PLATFORM_FEE_PERCENT };
    }

    interface PeriodAccumulator {
      grossKobo: number;
      netKobo: number;
      platformFeeKobo: number;
      byStream: Record<string, number>;
      byStreamNet: Record<string, number>;
    }

    function emptyPeriod(): PeriodAccumulator {
      return { grossKobo: 0, netKobo: 0, platformFeeKobo: 0, byStream: {}, byStreamNet: {} };
    }

    // Aggregate per period, applying per-stream splits
    const periods: Record<string, PeriodAccumulator> = {
      today: emptyPeriod(),
      week: emptyPeriod(),
      month: emptyPeriod(),
      allTime: emptyPeriod(),
    };

    for (const row of rows as unknown as Array<{
      stream: string;
      today_gross: string;
      week_gross: string;
      month_gross: string;
      all_time_gross: string;
    }>) {
      const { creatorPct, platformPct } = splitForStream(row.stream);

      const entries: Array<[keyof typeof periods, string]> = [
        ["today", row.today_gross],
        ["week", row.week_gross],
        ["month", row.month_gross],
        ["allTime", row.all_time_gross],
      ];

      for (const [periodKey, rawGross] of entries) {
        const gross = parseInt(rawGross ?? "0", 10);
        const net = Math.floor((gross * creatorPct) / 100);
        const fee = gross - net;

        periods[periodKey].grossKobo += gross;
        periods[periodKey].netKobo += net;
        periods[periodKey].platformFeeKobo += fee;
        periods[periodKey].byStream[row.stream] = gross;
        periods[periodKey].byStreamNet[row.stream] = net;
      }
    }

    return NextResponse.json({
      today: {
        grossKobo: periods.today.grossKobo,
        netKobo: periods.today.netKobo,
        platformFeeKobo: periods.today.platformFeeKobo,
        byStream: periods.today.byStream,
        byStreamNet: periods.today.byStreamNet,
      },
      week: {
        grossKobo: periods.week.grossKobo,
        netKobo: periods.week.netKobo,
        platformFeeKobo: periods.week.platformFeeKobo,
        byStream: periods.week.byStream,
        byStreamNet: periods.week.byStreamNet,
      },
      month: {
        grossKobo: periods.month.grossKobo,
        netKobo: periods.month.netKobo,
        platformFeeKobo: periods.month.platformFeeKobo,
        byStream: periods.month.byStream,
        byStreamNet: periods.month.byStreamNet,
      },
      allTime: {
        grossKobo: periods.allTime.grossKobo,
        netKobo: periods.allTime.netKobo,
        platformFeeKobo: periods.allTime.platformFeeKobo,
        byStream: periods.allTime.byStream,
        byStreamNet: periods.allTime.byStreamNet,
      },
      // Standard split (gifts, subscriptions, tips)
      platformFeePercent: STANDARD_PLATFORM_FEE_PERCENT,
      creatorSharePercent: STANDARD_CREATOR_PERCENT,
      // Sponsored quest split
      sponsoredQuestPlatformFeePercent: SPONSORED_QUEST_PLATFORM_FEE_PERCENT,
      sponsoredQuestCreatorSharePercent: SPONSORED_QUEST_CREATOR_PERCENT,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
