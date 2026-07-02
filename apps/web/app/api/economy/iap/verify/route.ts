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
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict } from "@/lib/api/errors";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import {
  EXPECTED_PACKAGE_NAME,
  verifyGooglePlayProductPurchase,
  consumeGooglePlayPurchase,
  verifyGooglePlaySubscriptionPurchase,
  acknowledgeGooglePlaySubscription,
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
  purchaseToken: z.string().min(1, "purchaseToken is required"),
  productId: z.enum(
    [
      // One-time coin purchases
      "coins_starter",
      "coins_regular",
      "coins_big",
      "coins_baller",
      "coins_boss",
      "coins_legend",
      // One-time star purchases
      "stars_starter",
      "stars_regular",
      "stars_big",
      "stars_boss",
      // Monthly subscription plans
      "sub_plus_monthly",
      "sub_pro_monthly",
      "sub_max_monthly",
      // Annual subscription plans
      "sub_plus_annual",
      "sub_pro_annual",
      "sub_max_annual",
    ],
    { errorMap: () => ({ message: "Unknown productId" }) }
  ),
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
async function verifyAndActivateSubscription(
  userId: string,
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<{ plan: string; coinsGranted: number }> {
  const subConfig = SUBSCRIPTION_PRODUCTS[productId];
  if (!subConfig) throw badRequest(`Unknown subscription productId: ${productId}`);

  const referenceId = `iap:sub:${purchaseToken}`;

  // Idempotency check
  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM coin_ledger WHERE reference_id = $1 LIMIT 1`,
    [referenceId]
  );
  if (existing.length > 0) {
    // Already processed — return current plan state
    const { rows: u } = await db.query<{ plan: string }>(
      `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return { plan: u[0]?.plan ?? subConfig.plan, coinsGranted: 0 };
  }

  // Verify with Google Play subscriptions API (different endpoint from products)
  const sub = await verifyGooglePlaySubscriptionPurchase(packageName, productId, purchaseToken);
  // paymentState: 1 = payment received, 2 = free trial. cancelReason defined means cancelled.
  if (sub.paymentState !== 1 && sub.paymentState !== 2) {
    throw badRequest("Subscription payment not confirmed", "SUBSCRIPTION_NOT_PAID");
  }
  // Acknowledge to prevent auto-cancellation after 3 days.
  await acknowledgeGooglePlaySubscription(packageName, productId, purchaseToken);

  // Activate plan and credit monthly coin bonus atomically (BUG-FIN-17: single transaction)
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE users SET plan = $1, plan_activated_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [subConfig.plan, userId]
    );

    // Credit the monthly coin bonus only when the configured amount is positive —
    // a 0-coin bonus config would insert a no-op ledger row and wastes a write.
    if (subConfig.monthlyCoins > 0) {
      await creditCoins(
        userId,
        subConfig.monthlyCoins,
        "subscription_bonus",
        referenceId,
        `Google Play subscription: ${productId} — monthly coin bonus`,
        { productId, packageName, purchaseToken },
        tx
      );
    }
  });

  return { plan: subConfig.plan, coinsGranted: subConfig.monthlyCoins };
}

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
      const result = await verifyAndActivateSubscription(
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

    // Use a reference key that encodes the purchaseToken for idempotency lookup
    const referenceId = `iap:${body.purchaseToken}`;

    // 1. Verify the purchase with Google Play Developer API
    const purchase = await verifyGooglePlayProductPurchase(
      body.packageName,
      body.productId,
      body.purchaseToken
    );

    // purchaseState: 0 = purchased (valid), anything else = not valid
    if (purchase.purchaseState !== 0) {
      throw badRequest(
        `Purchase is not in a valid state (state=${purchase.purchaseState})`,
        "PURCHASE_INVALID"
      );
    }

    // consumptionState: 0 = not yet consumed. A token that's already consumed
    // means a prior request already processed it — treat as duplicate.
    if (purchase.consumptionState !== 0) {
      throw conflict("This purchase has already been consumed", "PURCHASE_ALREADY_PROCESSED");
    }

    // 2. Credit coins/stars atomically. coin_ledger has a unique index on
    //    reference_id which prevents double-credit even under concurrent
    //    requests — catch 23505 (unique_violation) and surface it as 409.
    //    creditStars() is idempotent by design (returns the existing entry).
    if (isStarProduct) {
      await creditStars(
        userId,
        starsToGrant,
        "purchase",
        referenceId,
        `Google Play IAP: ${body.productId}`
      );
    } else {
      try {
        await creditCoins(
          userId,
          coinsToGrant,
          "iap_purchase",
          referenceId,
          `Google Play IAP: ${body.productId}`,
          {
            productId: body.productId,
            packageName: body.packageName,
            purchaseToken: body.purchaseToken,
            orderId: purchase.orderId,
          }
        );
      } catch (creditErr) {
        const pgCode = (creditErr as { code?: string })?.code;
        if (pgCode === "23505") {
          throw conflict("This purchase has already been processed", "PURCHASE_ALREADY_PROCESSED");
        }
        throw creditErr;
      }
    }

    // 3. Consume the purchase on Google Play so the user can buy the pack again.
    //    Done after crediting so coins/stars are never lost if consume fails.
    await consumeGooglePlayPurchase(
      body.packageName,
      body.productId,
      body.purchaseToken
    );

    return NextResponse.json(
      isStarProduct
        ? { success: true, coinsGranted: 0, starsGranted: starsToGrant }
        : { success: true, coinsGranted: coinsToGrant },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
