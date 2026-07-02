export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/coupons/redeem/route.ts
 *
 * POST /api/business/ads/coupons/redeem — apply a free/discounted-ad-spend
 * coupon code to one of the caller's own campaigns.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getOwnBusinessAccountId } from "@/lib/ads/limits";
import { redeemCoupon } from "@/lib/ads/repo";

const bodySchema = z.object({
  campaignId: z.string().uuid(),
  code: z.string().min(3).max(40),
});

export const POST = withAuth(async (req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await requireFeatureEnabled("adCoupons");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, bodySchema);

    const businessAccountId = await getOwnBusinessAccountId(auth.user.sub);
    if (!businessAccountId) throw notFound("Business account not found");

    try {
      const result = await redeemCoupon(auth.user.sub, body.campaignId, businessAccountId, body.code);
      return NextResponse.json({ success: true, data: result, error: null });
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : "Failed to redeem coupon");
    }
  } catch (err) {
    return handleApiError(err);
  }
});
