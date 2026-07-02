export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/campaigns/[campaignId]/fund/route.ts
 *
 * POST /api/business/ads/campaigns/:campaignId/fund — move Credits from the
 * caller's coin_balance into a campaign's ad budget. This is the "pay with
 * Zobia Credits" path (PRD §17 Pillar 3 — "pay with Zobia credits or cash").
 * The "pay with cash" path reuses the existing coin-purchase flow
 * (POST /api/economy/coins/purchase — Paystack/DodoPayments on web/PWA,
 * Google Play Billing on Android) to buy Credits first, then this endpoint
 * moves them into the campaign — no new payment integration needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getOwnBusinessAccountId } from "@/lib/ads/limits";
import { fundCampaign } from "@/lib/ads/repo";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AuthContext;
}

const bodySchema = z.object({
  amountCredits: z.number().int().positive().max(10_000_000),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const POST = withAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.coinPurchase);
    const { campaignId } = await params;
    const body = await validateBody(req, bodySchema);

    const businessAccountId = await getOwnBusinessAccountId(auth.user.sub);
    if (!businessAccountId) throw notFound("Business account not found");

    try {
      const campaign = await fundCampaign(
        auth.user.sub,
        campaignId,
        businessAccountId,
        body.amountCredits,
        body.idempotencyKey ?? `${campaignId}:fund:${randomUUID()}`
      );
      return NextResponse.json({ success: true, data: { campaign }, error: null });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "INSUFFICIENT_BALANCE") {
        throw badRequest("Insufficient Credit balance. Top up Credits first.", "INSUFFICIENT_BALANCE");
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
});
