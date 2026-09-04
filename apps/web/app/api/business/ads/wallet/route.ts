export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/wallet/route.ts
 *
 * GET /api/business/ads/wallet — the caller's Ad Wallet balance (Credits).
 * See lib/economy/adWallet.ts for how this differs from the main wallet.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getAdWalletBalance } from "@/lib/economy/adWallet";
import { getBalance } from "@/lib/economy/coins";

export const GET = withAuth(async (_req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const [adWalletBalance, mainWalletBalance] = await Promise.all([
      getAdWalletBalance(auth.user.sub),
      getBalance(auth.user.sub),
    ]);

    return NextResponse.json({
      success: true,
      data: { adWalletBalance, mainWalletBalance },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
