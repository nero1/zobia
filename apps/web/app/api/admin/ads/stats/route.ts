export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/stats/route.ts
 *
 * GET /api/admin/ads/stats — platform-wide ad revenue/performance overview
 * (Admin Dashboard "Financial Monitoring" style — PRD §20), plus a
 * moderation-queue depth count for the admin alerts panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

export const GET = withAdminAuth(async (_req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const [{ rows: totals }, { rows: pending }, { rows: topCampaigns }, { rows: daily }] = await Promise.all([
      db.query<{ active_campaigns: string; total_spend: string; total_budget: string }>(
        `SELECT COUNT(*) FILTER (WHERE status = 'active')::text AS active_campaigns,
                COALESCE(SUM(spent_credits), 0)::text AS total_spend,
                COALESCE(SUM(total_budget_credits), 0)::text AS total_budget
         FROM ad_campaigns WHERE deleted_at IS NULL`
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ad_campaigns WHERE moderation_status = 'pending' AND deleted_at IS NULL`
      ),
      db.query<{ id: string; name: string; spent_credits: string; advertiser_name: string | null }>(
        `SELECT c.id, c.name, c.spent_credits, COALESCE(ba.business_name, 'Zobia (Admin)') AS advertiser_name
         FROM ad_campaigns c LEFT JOIN business_accounts ba ON ba.id = c.business_account_id
         WHERE c.deleted_at IS NULL ORDER BY c.spent_credits DESC LIMIT 10`
      ),
      db.query<{ date: string; impressions: string; clicks: string; spend_credits: string }>(
        `SELECT date, SUM(impressions)::text AS impressions, SUM(clicks)::text AS clicks, SUM(spend_credits)::text AS spend_credits
         FROM ad_campaign_daily_stats WHERE date >= (CURRENT_DATE - 30) GROUP BY date ORDER BY date ASC`
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        activeCampaigns: Number(totals[0]?.active_campaigns ?? 0),
        totalSpendCredits: totals[0]?.total_spend ?? "0",
        totalBudgetCredits: totals[0]?.total_budget ?? "0",
        pendingModeration: Number(pending[0]?.count ?? 0),
        topCampaigns,
        dailyTrend: daily,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
