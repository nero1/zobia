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
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getOwnCampaign, listCreatives, submitCampaignForModeration } from "@/lib/ads/repo";
import { logger } from "@/lib/logger";
import { raiseAlert } from "@/lib/alerts/dispatch";

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

    const orm = await getDb();

    // Advertiser display name follows advertiser_type: the business page's
    // name, the business account's name, or the user's own display name.
    let advertiserName = "Advertiser";
    if (campaign.advertiser_type === "business_page" && campaign.business_page_id) {
      const [row] = await orm
        .select({ name: schema.businessPages.name })
        .from(schema.businessPages)
        .where(eq(schema.businessPages.id, campaign.business_page_id))
        .limit(1);
      advertiserName = row?.name ?? advertiserName;
    } else if (campaign.business_account_id) {
      const [row] = await orm
        .select({ business_name: schema.businessAccounts.businessName })
        .from(schema.businessAccounts)
        .where(eq(schema.businessAccounts.id, campaign.business_account_id))
        .limit(1);
      advertiserName = row?.business_name ?? advertiserName;
    } else {
      const [row] = await orm
        .select({ display_name: schema.users.displayName, username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.id, auth.user.sub))
        .limit(1);
      advertiserName = row?.display_name ?? row?.username ?? advertiserName;
    }

    const { moderationStatus, reason } = await submitCampaignForModeration(campaign, advertiserName);

    if (moderationStatus === "pending") {
      await raiseAlert(orm, {
        type: "ad_campaign_pending_review",
        category: "moderation",
        priorityLevel: 6,
        title: "Ad campaign pending review",
        message: `Advertiser "${advertiserName}" submitted an ad campaign ("${campaign.name}") pending moderation.`,
        metadata: { campaignId, businessAccountId: campaign.business_account_id },
        dedupeKey: `ad_campaign_pending_review:${campaignId}`,
      }).catch((err) => logger.error({ err }, "[business/ads/submit] failed to write system_alert"));
    }

    return NextResponse.json({ success: true, data: { campaignId, moderationStatus, reason }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
