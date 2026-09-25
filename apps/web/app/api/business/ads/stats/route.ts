export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/stats/route.ts
 *
 * GET /api/business/ads/stats — advertiser-facing ad performance, depth
 * gated by business tier exactly like /api/business/pages/stats
 * (lib/business/limits.ts getBusinessStatsTier): starter = totals only,
 * growth = totals + per-campaign breakdown, enterprise = + 90-day daily
 * drill-down (CSV export via /stats/export, Enterprise only).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBusinessStatsTier } from "@/lib/business/limits";
import { getCampaignTotals, getCampaignDailyStats } from "@/lib/ads/repo";

export const GET = withAuth(async (_req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    // A personal advertiser (no Business Account) gets the same stats depth
    // as a "starter" business tier — totals only, no per-campaign breakdown.
    const orm = await getDb();
    const [bizRow] = await orm
      .select({ tier: schema.businessAccounts.tier })
      .from(schema.businessAccounts)
      .where(eq(schema.businessAccounts.userId, auth.user.sub))
      .limit(1);
    const tier = getBusinessStatsTier(bizRow?.tier ?? "starter");
    const totals = await getCampaignTotals(auth.user.sub);
    const data: Record<string, unknown> = { tier, totals };

    if (tier === "more" || tier === "detailed" || tier === "detailed_export") {
      const campaigns = await orm
        .select({
          id: schema.adCampaigns.id,
          name: schema.adCampaigns.name,
          status: schema.adCampaigns.status,
          spent_credits: schema.adCampaigns.spentCredits,
          total_budget_credits: schema.adCampaigns.totalBudgetCredits,
        })
        .from(schema.adCampaigns)
        .where(and(eq(schema.adCampaigns.createdBy, auth.user.sub), isNull(schema.adCampaigns.deletedAt)))
        .orderBy(desc(schema.adCampaigns.createdAt));
      data.campaignBreakdown = campaigns;
    }
    if (tier === "detailed" || tier === "detailed_export") {
      const campaignIds = await orm
        .select({ id: schema.adCampaigns.id })
        .from(schema.adCampaigns)
        .where(and(eq(schema.adCampaigns.createdBy, auth.user.sub), isNull(schema.adCampaigns.deletedAt)));
      const dailyByCampaign: Record<string, unknown> = {};
      for (const c of campaignIds) {
        dailyByCampaign[c.id] = await getCampaignDailyStats(c.id, 90);
      }
      data.dailyStats = dailyByCampaign;
    }
    data.canExport = tier === "detailed_export";

    return NextResponse.json({ success: true, data, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
