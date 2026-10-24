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

import Decimal from "decimal.js";
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { forbidden, handleApiError } from "@/lib/api/errors";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

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
    const orm = await getDb();
    const [creatorRow] = await orm
      .select({ is_creator: schema.users.isCreator })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!creatorRow?.is_creator) {
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
    const { rows } = await orm.execute<EarningsRow & Record<string, unknown>>(sql`
       SELECT
         source_type AS stream,
         COALESCE(SUM(gross_amount_kobo) FILTER (WHERE created_at >= CURRENT_DATE),0)::text AS today_gross,
         COALESCE(SUM(net_amount_kobo) FILTER (WHERE created_at >= CURRENT_DATE),0)::text AS today_net,
         COALESCE(SUM(platform_fee_kobo) FILTER (WHERE created_at >= CURRENT_DATE),0)::text AS today_fee,
         COALESCE(SUM(gross_amount_kobo) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),0)::text AS week_gross,
         COALESCE(SUM(net_amount_kobo) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),0)::text AS week_net,
         COALESCE(SUM(platform_fee_kobo) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),0)::text AS week_fee,
         COALESCE(SUM(gross_amount_kobo) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'),0)::text AS month_gross,
         COALESCE(SUM(net_amount_kobo) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'),0)::text AS month_net,
         COALESCE(SUM(platform_fee_kobo) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'),0)::text AS month_fee,
         COALESCE(SUM(gross_amount_kobo),0)::text AS all_time_gross,
         COALESCE(SUM(net_amount_kobo),0)::text AS all_time_net,
         COALESCE(SUM(platform_fee_kobo),0)::text AS all_time_fee
       FROM creator_earnings
       WHERE creator_id = ${userId}
       GROUP BY source_type
    `);

    // Standard streams: platform 20%, creator 80%.
    // Sponsored quest stream: platform 30%, creator 70% (PRD §Sponsored Quests).
    const STANDARD_PLATFORM_FEE_PERCENT = 20;
    const STANDARD_CREATOR_PERCENT = 80;
    const SPONSORED_QUEST_PLATFORM_FEE_PERCENT = 30;
    const SPONSORED_QUEST_CREATOR_PERCENT = 70;

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

    const exactNumber=(value:Decimal.Value)=>{
      const amount=new Decimal(value);
      if(!amount.isInteger() || amount.abs().gt(Number.MAX_SAFE_INTEGER))throw new Error("Earnings summary exceeds the exact numeric response range; use the ledger export");
      return amount.toNumber();
    };
    for(const row of rows as unknown as Array<Record<string,string>>) {
      for(const [periodKey,prefix] of [["today","today"],["week","week"],["month","month"],["allTime","all_time"]]) {
        const gross=exactNumber(row[`${prefix}_gross`]??0),net=exactNumber(row[`${prefix}_net`]??0),fee=exactNumber(row[`${prefix}_fee`]??0);
        const period=periods[periodKey];
        period.grossKobo=exactNumber(new Decimal(period.grossKobo).add(gross));
        period.netKobo=exactNumber(new Decimal(period.netKobo).add(net));
        period.platformFeeKobo=exactNumber(new Decimal(period.platformFeeKobo).add(fee));
        period.byStream[row.stream]=gross;
        period.byStreamNet[row.stream]=net;
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
