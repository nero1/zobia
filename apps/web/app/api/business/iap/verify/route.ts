export const dynamic = 'force-dynamic';

/**
 * app/api/business/iap/verify/route.ts
 *
 * Google Play Billing verification for Business Account signup/upgrade —
 * the Android-only counterpart to app/api/business/route.ts (POST) and
 * app/api/business/tier/route.ts (PATCH), which use Paystack/DodoPayments
 * checkout links. Per PRD §18, Google Play Billing is the sole in-app
 * purchase mechanism on Android; Paystack/DodoPayments are web/PWA-only.
 *
 * POST /api/business/iap/verify
 *   Body: { purchaseToken, productId, packageName, business_name?, business_type? }
 *   - Verifies the subscription purchase with the Google Play Developer API
 *   - No existing business account → creates one at the purchased tier
 *     (business_name required in this case)
 *   - Existing business account → upgrades/downgrades to the purchased tier,
 *     cancelling any pending downgrade
 *   - Records a `payments` row (provider "google_play") for revenue
 *     reporting parity with the Paystack/DodoPayments flows
 *   - Idempotent via payments.idempotency_key keyed on purchaseToken
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled, loadManifest } from "@/lib/manifest";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import {
  EXPECTED_PACKAGE_NAME,
  verifyGooglePlaySubscriptionPurchase,
  acknowledgeGooglePlaySubscription,
} from "@/lib/payments/googlePlayVerify";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps Google Play subscription product IDs to Business Account tiers. */
const BUSINESS_TIER_PRODUCTS: Record<string, "starter" | "growth" | "enterprise"> = {
  biz_starter_monthly: "starter",
  biz_growth_monthly: "growth",
  biz_enterprise_monthly: "enterprise",
};

/** Default tier prices in kobo (admin can override via x_manifest, same keys as the web flow). */
const DEFAULT_TIER_PRICE_KOBO: Record<string, number> = {
  starter: 500_000,      // ₦5,000
  growth: 1_500_000,     // ₦15,000
  enterprise: 5_000_000, // ₦50,000
};

const verifyBusinessIapSchema = z.object({
  purchaseToken: z.string().min(1, "purchaseToken is required"),
  productId: z.enum(["biz_starter_monthly", "biz_growth_monthly", "biz_enterprise_monthly"], {
    errorMap: () => ({ message: "Unknown productId" }),
  }),
  packageName: z.string().min(1, "packageName is required"),
  business_name: z.string().min(2).max(120).optional(),
  business_type: z.string().max(80).optional(),
});

async function resolveTierPriceKobo(tier: string): Promise<number> {
  let priceKobo = DEFAULT_TIER_PRICE_KOBO[tier] ?? 0;
  try {
    const manifest = await loadManifest();
    const manifestKey = `business_${tier}_price_kobo` as keyof typeof manifest;
    const manifestPrice = (manifest as unknown as Record<string, unknown>)[manifestKey];
    if (typeof manifestPrice === "number" && manifestPrice > 0) {
      priceKobo = manifestPrice;
    }
  } catch {
    // Fall back to defaults
  }
  return priceKobo;
}

// ---------------------------------------------------------------------------
// POST /api/business/iap/verify
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, verifyBusinessIapSchema);

    // IAP-01: validate packageName against expected bundle ID
    if (body.packageName !== EXPECTED_PACKAGE_NAME) {
      throw badRequest(`Invalid packageName: expected ${EXPECTED_PACKAGE_NAME}`, "INVALID_PACKAGE_NAME");
    }

    const tier = BUSINESS_TIER_PRODUCTS[body.productId];
    const idempotencyKey = `play:biz:${body.purchaseToken}`;

    // Idempotency check — a replayed client call (e.g. the purchase listener
    // firing twice) simply returns the already-applied result.
    const { rows: alreadyProcessed } = await db.query<{ id: string }>(
      `SELECT id FROM payments WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey]
    );
    if (alreadyProcessed.length > 0) {
      const { rows: existingAccount } = await db.query<{ tier: string }>(
        `SELECT tier FROM business_accounts WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      return NextResponse.json({ success: true, data: { tier: existingAccount[0]?.tier ?? tier } }, { status: 200 });
    }

    // Verify with Google Play subscriptions API.
    const sub = await verifyGooglePlaySubscriptionPurchase(body.packageName, body.productId, body.purchaseToken);
    // paymentState: 1 = payment received, 2 = free trial. cancelReason defined means cancelled.
    if (sub.paymentState !== 1 && sub.paymentState !== 2) {
      throw badRequest("Subscription payment not confirmed", "SUBSCRIPTION_NOT_PAID");
    }

    const priceKobo = await resolveTierPriceKobo(tier);

    const { rows: existingRows } = await db.query<{ id: string; tier: string }>(
      `SELECT id, tier FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    let itemType: "business_signup" | "business_upgrade";
    let businessAccountId: string;

    if (!existingRows[0]) {
      // Signup — first purchase, no business account yet.
      if (!body.business_name) {
        throw badRequest("business_name is required to create a Business Account", "BUSINESS_NAME_REQUIRED");
      }
      itemType = "business_signup";
      const { rows: created } = await db.query<{ id: string }>(
        `INSERT INTO business_accounts
           (user_id, business_name, business_type, tier, verified, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, 'active', NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING
         RETURNING id`,
        [userId, body.business_name, body.business_type ?? null, tier]
      );
      if (!created[0]) {
        // Lost a race against a concurrent signup — re-read and treat as upgrade below.
        const { rows: raced } = await db.query<{ id: string }>(
          `SELECT id FROM business_accounts WHERE user_id = $1 LIMIT 1`,
          [userId]
        );
        if (!raced[0]) throw notFound("Business account not found after creation race");
        businessAccountId = raced[0].id;
        itemType = "business_upgrade";
        await db.query(
          `UPDATE business_accounts
           SET tier = $1, downgrade_to_tier = NULL, downgrade_effective_at = NULL,
               tier_updated_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [tier, businessAccountId]
        );
      } else {
        businessAccountId = created[0].id;
      }
    } else {
      // Upgrade/downgrade — activate immediately (Play purchase already
      // completed, unlike the self-service downgrade-with-grace-period flow
      // in PATCH /api/business/tier which applies before any payment).
      itemType = "business_upgrade";
      businessAccountId = existingRows[0].id;
      await db.query(
        `UPDATE business_accounts
         SET tier = $1, pending_tier = NULL, pending_payment_ref = NULL,
             downgrade_to_tier = NULL, downgrade_effective_at = NULL,
             tier_updated_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [tier, businessAccountId]
      );
    }

    // Acknowledge to prevent Google Play auto-cancelling after 3 days.
    await acknowledgeGooglePlaySubscription(body.packageName, body.productId, body.purchaseToken);

    // Record the payment for revenue reporting parity with Paystack/DodoPayments.
    await db.query(
      `INSERT INTO payments
         (user_id, payment_type, amount_kobo, currency, provider,
          status, idempotency_key, provider_reference, metadata, completed_at)
       VALUES ($1, 'business_upgrade', $2, 'NGN', 'google_play',
               'completed', $3, $3, $4::jsonb, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        userId,
        priceKobo,
        idempotencyKey,
        JSON.stringify({ itemType, businessAccountId, tier, productId: body.productId, purchaseToken: body.purchaseToken }),
      ]
    );

    await db.query(
      `INSERT INTO notifications
         (user_id, type, title, body, metadata, is_read, created_at)
       VALUES ($1, 'business_tier_activated', $2, $3, $4::jsonb, false, NOW())`,
      [
        userId,
        itemType === "business_signup" ? "Business Account Created" : "Business Account Upgraded",
        itemType === "business_signup"
          ? `Your Business ${tier.charAt(0).toUpperCase() + tier.slice(1)} account is now active.`
          : `Your business account has been upgraded to the ${tier.charAt(0).toUpperCase() + tier.slice(1)} tier.`,
        JSON.stringify({ businessAccountId, tier }),
      ]
    );

    return NextResponse.json({ success: true, data: { tier } }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
