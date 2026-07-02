export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/campaigns/[campaignId]/creatives/route.ts
 *
 * POST /api/business/ads/campaigns/:campaignId/creatives — attach a
 * creative to a draft campaign. Self-service creatives are restricted to
 * html|text|image|native — third_party ad tags (raw injected script/markup)
 * are admin-only (app/api/admin/ads/campaigns) since they're an XSS/trust
 * boundary that a self-service advertiser must not cross.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getOwnBusinessAccountId } from "@/lib/ads/limits";
import { getOwnCampaign, addCreative } from "@/lib/ads/repo";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AuthContext;
}

const createSchema = z.object({
  placementKey: z.string().min(1).max(50),
  format: z.enum(["html", "text", "image", "native"]),
  size: z.enum(["300x250", "320x50", "interstitial", "rewarded", "native"]),
  title: z.string().max(150).optional(),
  body: z.string().max(2000).optional(),
  imageUrl: z.string().url().max(1000).optional(),
  clickUrl: z.string().url().max(1000),
  ctaLabel: z.string().max(40).optional(),
});

export const POST = withAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { campaignId } = await params;
    const body = await validateBody(req, createSchema);

    const businessAccountId = await getOwnBusinessAccountId(auth.user.sub);
    if (!businessAccountId) throw notFound("Business account not found");

    const campaign = await getOwnCampaign(campaignId, businessAccountId);
    if (!campaign) throw notFound("Campaign not found");
    if (campaign.status !== "draft") throw badRequest("Creatives can only be added while the campaign is a draft.");

    const creative = await addCreative(campaignId, body);
    return NextResponse.json({ success: true, data: { creative }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
