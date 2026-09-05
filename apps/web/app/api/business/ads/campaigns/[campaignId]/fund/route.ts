export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/campaigns/[campaignId]/fund/route.ts
 *
 * POST /api/business/ads/campaigns/:campaignId/fund — move Credits from the
 * caller's Ad Wallet (lib/economy/adWallet.ts) into a campaign's ad budget.
 * The Ad Wallet itself is funded via POST /api/business/ads/wallet/transfer
 * (from the main Credits balance) or POST /api/business/ads/wallet/topup
 * (direct purchase) — see those routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
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

    try {
      const campaign = await fundCampaign(
        auth.user.sub,
        campaignId,
        body.amountCredits,
        body.idempotencyKey ?? `${campaignId}:fund:${randomUUID()}`
      );
      return NextResponse.json({ success: true, data: { campaign }, error: null });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "INSUFFICIENT_AD_WALLET_BALANCE") {
        throw badRequest("Insufficient Ad Wallet balance. Fund your Ad Wallet first.", "INSUFFICIENT_AD_WALLET_BALANCE");
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
});
