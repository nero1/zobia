export const dynamic = 'force-dynamic';

/**
 * app/api/economy/iap/verify/route.ts
 *
 * Google Play server-side purchase verification.
 *
 * POST /api/economy/iap/verify
 *   - Validates JWT auth (withAuth middleware)
 *   - Verifies the purchase token with the Google Play Developer API
 *   - Checks idempotency via coin_ledger/star_ledger reference field
 *   - Credits coins/stars atomically, or activates a subscription plan
 *   - Acknowledges (consumes) the purchase on Google Play
 *   - Returns { success: true, coinsGranted, starsGranted?, plan? }
 *
 * Security: SELECT FOR UPDATE prevents race conditions.
 * Returns 409 if purchaseToken was already processed.
 *
 * Google Play Developer API calls (JWT signing, OAuth, verify/consume/
 * acknowledge) live in lib/payments/googlePlayVerify.ts, shared with
 * app/api/business/iap/verify/route.ts (Business Account signup/upgrade).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { activatePlayConsumable, activatePlaySubscription } from "@/lib/plans/playSubscription";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import {
  EXPECTED_PACKAGE_NAME,
} from "@/lib/payments/googlePlayVerify";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maps Google Play one-time product IDs to coin amounts.
 * Must stay in sync with apps/android/src/lib/payments/googlePlay.ts COIN_PRODUCTS.
 */
const COIN_PRODUCTS: Record<string, number> = {
  coins_starter: 100,
  coins_regular: 350,
  coins_big: 800,
  coins_baller: 1800,
  coins_boss: 5000,
  coins_legend: 11500,
};

/**
 * Maps Google Play one-time product IDs to star amounts.
 * Must stay in sync with apps/android/src/lib/payments/googlePlay.ts STAR_PRODUCTS.
 */
const STAR_PRODUCTS: Record<string, number> = {
  stars_starter: 10,
  stars_regular: 30,
  stars_big: 80,
  stars_boss: 200,
};

/**
 * Maps Google Play subscription product IDs to plan tiers and monthly coin bonuses.
 * Must stay in sync with apps/android/src/lib/payments/googlePlay.ts SUBSCRIPTION_PRODUCTS.
 */
const SUBSCRIPTION_PRODUCTS: Record<string, { plan: string; monthlyCoins: number }> = {
  sub_plus_monthly:  { plan: "plus", monthlyCoins: 50 },
  sub_pro_monthly:   { plan: "pro",  monthlyCoins: 200 },
  sub_max_monthly:   { plan: "max",  monthlyCoins: 500 },
  sub_plus_annual:   { plan: "plus", monthlyCoins: 50 },
  sub_pro_annual:    { plan: "pro",  monthlyCoins: 200 },
  sub_max_annual:    { plan: "max",  monthlyCoins: 500 },
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const verifyIapSchema = z.object({
  purchaseToken: z.string().min(1, "purchaseToken is required").max(4096),
  productId: z.string().regex(/^[a-z0-9][a-z0-9._]{0,147}$/),
  packageName: z.string().min(1, "packageName is required"),
  /** Set to true when productId is a subscription (not a one-time purchase). */
  isSubscription: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Subscription activation
// ---------------------------------------------------------------------------

/**
 * Verify a Google Play subscription purchase and activate the user's plan.
 *
 * Uses the purchases.subscriptions API (not purchases.products) for subscriptions.
 * Idempotent via coin_ledger reference_id keyed on purchaseToken.
 */
// ---------------------------------------------------------------------------
// POST /api/economy/iap/verify
// ---------------------------------------------------------------------------

/**
 * Verify a Google Play purchase and credit coins/stars, or activate a subscription plan.
 *
 * Handles one-time coin/star purchases and recurring subscription products.
 * Idempotent: returns 409 if the purchaseToken has already been processed.
 * Uses SELECT FOR UPDATE to prevent race conditions on the user row.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, verifyIapSchema);

    // IAP-01: validate packageName against expected bundle ID
    if (body.packageName !== EXPECTED_PACKAGE_NAME) {
      throw badRequest(
        `Invalid packageName: expected ${EXPECTED_PACKAGE_NAME}`,
        "INVALID_PACKAGE_NAME"
      );
    }

    const userId = auth.user.sub;

    // Rate-limit per user to prevent purchase-token replay flooding.
    await enforceRateLimit(userId, "user", RATE_LIMITS.coinPurchase);

    // Route to subscription handler when productId is a subscription product
    const isSubscription = body.isSubscription || !!SUBSCRIPTION_PRODUCTS[body.productId];
    if (isSubscription) {
      const result = await activatePlaySubscription(
        userId,
        body.packageName,
        body.productId,
        body.purchaseToken
      );
      return NextResponse.json(
        { success: true, coinsGranted: result.coinsGranted, plan: result.plan },
        { status: 200 }
      );
    }

    // --- One-time coin/star purchase flow ---
    const isStarProduct = STAR_PRODUCTS[body.productId] !== undefined;
    const coinsToGrant = COIN_PRODUCTS[body.productId];
    const starsToGrant = STAR_PRODUCTS[body.productId];
    if (coinsToGrant === undefined && starsToGrant === undefined) {
      throw badRequest(`Unknown productId: ${body.productId}`, "UNKNOWN_PRODUCT");
    }

    const result = await activatePlayConsumable(userId, body.packageName, body.productId, body.purchaseToken, coinsToGrant ?? 0, starsToGrant ?? 0);
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
