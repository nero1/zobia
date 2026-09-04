export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/campaigns/[campaignId]/submit/route.ts
 *
 * POST /api/business/ads/campaigns/:campaignId/submit — send a draft
 * campaign (with at least one creative) into moderation. Unlike the
 * platform's original design, a campaign no longer needs to be funded
 * before submission — advertisers can create and preview an ad with an
 * empty Ad Wallet; it simply won't start serving impressions until funded
 * (see lib/ads/serve.ts and the campaign PATCH "activate" notification).
 * Mirrors app/api/business/sponsored-quests's AI/manual review split
 * (lib/ads/repo.ts submitCampaignForModeration).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getOwnCampaign, listCreatives, submitCampaignForModeration } from "@/lib/ads/repo";
import { logger } from "@/lib/logger";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AuthContext;
}

export const POST = withAuth(async (_req: NextRequest, { params, auth }: Ctx) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { campaignId } = await params;

    const campaign = await getOwnCampaign(campaignId, auth.user.sub);
    if (!campaign) throw notFound("Campaign not found");
    if (campaign.status !== "draft") throw badRequest(`Campaign is already ${campaign.status}.`);

    const creatives = await listCreatives(campaignId);
    if (creatives.length === 0) throw badRequest("Add at least one creative before submitting.");

    // Advertiser display name follows advertiser_type: the business page's
    // name, the business account's name, or the user's own display name.
    let advertiserName = "Advertiser";
    if (campaign.advertiser_type === "business_page" && campaign.business_page_id) {
      const { rows } = await db.query<{ name: string }>(`SELECT name FROM business_pages WHERE id = $1 LIMIT 1`, [campaign.business_page_id]);
      advertiserName = rows[0]?.name ?? advertiserName;
    } else if (campaign.business_account_id) {
      const { rows } = await db.query<{ business_name: string }>(`SELECT business_name FROM business_accounts WHERE id = $1 LIMIT 1`, [campaign.business_account_id]);
      advertiserName = rows[0]?.business_name ?? advertiserName;
    } else {
      const { rows } = await db.query<{ display_name: string | null; username: string | null }>(
        `SELECT display_name, username FROM users WHERE id = $1 LIMIT 1`,
        [auth.user.sub]
      );
      advertiserName = rows[0]?.display_name ?? rows[0]?.username ?? advertiserName;
    }

    const { moderationStatus, reason } = await submitCampaignForModeration(campaign, advertiserName);

    if (moderationStatus === "pending") {
      await db
        .query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('ad_campaign_pending_review', 'info', $1, $2::jsonb, NOW())`,
          [
            `Advertiser "${advertiserName}" submitted an ad campaign ("${campaign.name}") pending moderation.`,
            JSON.stringify({ campaignId, businessAccountId: campaign.business_account_id }),
          ]
        )
        .catch((err) => logger.error({ err }, "[business/ads/submit] failed to write system_alert"));
    }

    return NextResponse.json({ success: true, data: { campaignId, moderationStatus, reason }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
