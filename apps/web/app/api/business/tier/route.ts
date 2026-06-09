export const dynamic = 'force-dynamic';

/**
 * app/api/business/tier/route.ts
 *
 * PATCH /api/business/tier
 *
 * Upgrade the authenticated user's business account tier.
 * Body: { tier: "growth" | "enterprise", paymentProvider?: "paystack" | "dodopayments" }
 *
 * Flow (PRD §17):
 *   1. Validate the requested tier is higher than the current tier.
 *   2. Determine tier price from x_manifest (admin-configurable).
 *   3. Initiate payment with Paystack (Nigeria) or DodoPayments (international).
 *   4. Store pending_tier + pending_payment_ref on the business account record.
 *   5. Return { paymentUrl } — client redirects user to checkout.
 *   6. On charge.success webhook (paystack/dodopayments), the tier is activated.
 *
 * Tier prices (admin-configurable in x_manifest, defaults from PRD §17):
 *   starter  → free (creation only; no upgrade needed)
 *   growth   → ₦15,000/month  (1,500,000 kobo)
 *   enterprise → ₦50,000/month (5,000,000 kobo)
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { initializePayment as paystackInit } from "@/lib/payments/paystack";
import { createPaymentSession as dodoCreateSession } from "@/lib/payments/dodopayments";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_ORDER: Record<string, number> = {
  starter: 1,
  growth: 2,
  enterprise: 3,
};

/** Default tier prices in kobo (admin can override via x_manifest). */
const DEFAULT_TIER_PRICE_KOBO: Record<string, number> = {
  growth: 1_500_000,     // ₦15,000
  enterprise: 5_000_000, // ₦50,000
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const upgradeTierSchema = z.object({
  tier: z.enum(["growth", "enterprise"]),
  paymentProvider: z.enum(["paystack", "dodopayments"]).optional(),
});

// ---------------------------------------------------------------------------
// PATCH /api/business/tier
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const body = await validateBody(req, upgradeTierSchema);
    const { tier: newTier, paymentProvider } = body;

    // Load user record (we need their email for the payment provider)
    const { rows: userRows } = await db.query<{ id: string; email: string | null; plan: string }>(
      `SELECT id, email, plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!userRows[0]) throw notFound("User not found");

    const userEmail = userRows[0].email ?? `${userId}@zobia.placeholder`;

    // Fetch current business account
    const { rows } = await db.query<{ id: string; tier: string }>(
      `SELECT id, tier FROM business_accounts WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!rows[0]) throw notFound("No business account found");

    const currentTier = rows[0].tier.toLowerCase();
    if ((TIER_ORDER[currentTier] ?? 0) >= (TIER_ORDER[newTier] ?? 0)) {
      throw badRequest(`Cannot downgrade or re-purchase from ${currentTier} to ${newTier}`);
    }

    // Resolve tier price from x_manifest (admin-configurable)
    let priceKobo = DEFAULT_TIER_PRICE_KOBO[newTier] ?? 0;
    try {
      const manifest = await loadManifest();
      const manifestKey = `business_${newTier}_price_kobo` as keyof typeof manifest;
      const manifestPrice = (manifest as unknown as Record<string, unknown>)[manifestKey];
      if (typeof manifestPrice === "number" && manifestPrice > 0) {
        priceKobo = manifestPrice;
      }
    } catch {
      // Fall back to defaults
    }

    if (priceKobo <= 0) {
      throw badRequest("Invalid tier price configuration");
    }

    // Determine payment provider
    const provider = paymentProvider ?? "paystack";

    // Generate idempotency reference
    const reference = `biz-tier-${rows[0].id}-${newTier}-${randomUUID().slice(0, 8)}`;

    // Mark the tier change as pending before initiating payment
    await db.query(
      `UPDATE business_accounts
       SET pending_tier = $1, pending_payment_ref = $2, updated_at = NOW()
       WHERE id = $3`,
      [newTier, reference, rows[0].id]
    );

    // Initiate payment
    let paymentUrl: string;
    if (provider === "paystack") {
      const ps = await paystackInit(priceKobo, userEmail, reference, {
        userId,
        type: "business_upgrade",
        businessAccountId: rows[0].id,
        newTier,
        itemType: "business_upgrade",
      });
      paymentUrl = ps.authorization_url;
    } else {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.social";
      const dd = await dodoCreateSession(priceKobo, "NGN", `${appUrl}/settings/business?upgraded=1`, {
        userId,
        type: "business_upgrade",
        businessAccountId: rows[0].id,
        newTier,
        itemType: "business_upgrade",
        reference,
      });
      paymentUrl = dd.payment_url;
    }

    return NextResponse.json({
      success: true,
      data: {
        paymentUrl,
        reference,
        tier: newTier,
        priceKobo,
        message: `Complete payment to activate your ${newTier} business account`,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
