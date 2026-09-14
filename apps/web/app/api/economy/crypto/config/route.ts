export const dynamic = 'force-dynamic';

/**
 * GET /api/economy/crypto/config?context=business_tier
 *
 * Public per-context payment config the client uses to decide what payment
 * options to show: which Nigeria method(s) are active, which crypto
 * currencies are active, whether the context is entirely free, and (for
 * non-Nigerian users with nothing active) the "only Nigeria supported"
 * message.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getPaymentContextSettings, PAYMENT_CONTEXT_KEYS } from "@/lib/payments/contextSettings";
import { getAllCryptoDiscounts } from "@/lib/payments/crypto/settings";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const context = new URL(req.url).searchParams.get("context");
    if (!context || !(PAYMENT_CONTEXT_KEYS as readonly string[]).includes(context)) {
      throw badRequest(`context must be one of: ${PAYMENT_CONTEXT_KEYS.join(", ")}`);
    }

    const [settings, discounts, userRow] = await Promise.all([
      getPaymentContextSettings(context as (typeof PAYMENT_CONTEXT_KEYS)[number]),
      getAllCryptoDiscounts(),
      db.query<{ country: string | null }>(`SELECT country FROM users WHERE id = $1 LIMIT 1`, [auth.user.sub]),
    ]);

    const isNigeria = (userRow.rows[0]?.country ?? "NG") === "NG";
    const hasAnyMethod = settings.isFree || (isNigeria && settings.paystackEnabled) || settings.cryptoEnabledCurrencies.length > 0;

    return NextResponse.json({
      success: true,
      data: {
        isFree: settings.isFree,
        isNigeria,
        paystackEnabled: isNigeria && settings.paystackEnabled,
        cryptoEnabledCurrencies: settings.cryptoEnabledCurrencies,
        discounts,
        unsupportedRegion: !hasAnyMethod,
        unsupportedRegionMessage: !hasAnyMethod
          ? "Only Nigeria is supported for this at this time. We are working to add more countries."
          : null,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
