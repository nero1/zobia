export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/stats/route.ts
 *
 * GET /api/admin/ads/stats — platform-wide ad revenue/performance overview
 * (Admin Dashboard "Financial Monitoring" style — PRD §20), plus a
 * moderation-queue depth count for the admin alerts panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

export const GET = withAdminAuth(async (_req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const orm = await getDb();
    const ac = schema.adCampaigns;
    const ads = schema.adCampaignDailyStats;

    const [[totalsRow], [pendingRow], topCampaigns, daily] = await Promise.all([
      orm
        .select({
          active_campaigns: sql<string>`COUNT(*) FILTER (WHERE ${ac.status} = 'active')::text`,
          total_spend: sql<string>`COALESCE(SUM(${ac.spentCredits}), 0)::text`,
          total_budget: sql<string>`COALESCE(SUM(${ac.totalBudgetCredits}), 0)::text`,
        })
        .from(ac)
        .where(isNull(ac.deletedAt)),
      orm
        .select({ count: sql<string>`COUNT(*)::text` })
        .from(ac)
        .where(and(eq(ac.moderationStatus, "pending"), isNull(ac.deletedAt))),
      orm
        .select({
          id: ac.id,
          name: ac.name,
          spent_credits: ac.spentCredits,
          advertiser_name: sql<string>`COALESCE(${schema.businessAccounts.businessName}, 'Zobia (Admin)')`,
        })
        .from(ac)
        .leftJoin(schema.businessAccounts, eq(schema.businessAccounts.id, ac.businessAccountId))
        .where(isNull(ac.deletedAt))
        .orderBy(desc(ac.spentCredits))
        .limit(10),
      orm
        .select({
          date: ads.date,
          impressions: sql<string>`SUM(${ads.impressions})::text`,
          clicks: sql<string>`SUM(${ads.clicks})::text`,
          spend_credits: sql<string>`SUM(${ads.spendCredits})::text`,
        })
        .from(ads)
        .where(gte(ads.date, sql`(CURRENT_DATE - 30)`))
        .groupBy(ads.date)
        .orderBy(ads.date),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        activeCampaigns: Number(totalsRow?.active_campaigns ?? 0),
        totalSpendCredits: totalsRow?.total_spend ?? "0",
        totalBudgetCredits: totalsRow?.total_budget ?? "0",
        pendingModeration: Number(pendingRow?.count ?? 0),
        topCampaigns,
        dailyTrend: daily,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
