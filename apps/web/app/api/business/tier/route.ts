export const dynamic = 'force-dynamic';

/**
 * app/api/business/tier/route.ts
 *
 * PATCH /api/business/tier
 *
 * Upgrade or downgrade the authenticated user's business account tier.
 * Body: { tier: "starter" | "growth" | "enterprise", paymentProvider?: "paystack" | "dodopayments" }
 *
 * Upgrade flow (PRD §17):
 *   1. Validate the requested tier is higher than the current tier.
 *   2. Determine tier price from x_manifest (admin-configurable).
 *   3. Initiate payment with Paystack (Nigeria) or DodoPayments (international).
 *   4. Store pending_tier + pending_payment_ref on the business account record.
 *   5. Return { paymentUrl } — client redirects user to checkout.
 *   6. On charge.success webhook (paystack/dodopayments), the tier is activated.
 *
 * Downgrade flow (self-service, no payment): the account keeps its current
 * tier — and everything that comes with it (page slots, live sponsored
 * quests) — for a uniform 30-day grace period (admin-configurable via
 * x_manifest `business_downgrade_grace_days`). The daily-economy CRON sweep
 * (lib/business/downgradeSweep.ts) applies the new tier once the grace
 * period elapses: extra pages beyond the new tier's slot limit are
 * deactivated and any running sponsored quests are stopped.
 * Requesting the current tier again cancels a pending downgrade.
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
import { handleApiError, notFound, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { initializePayment as paystackInit } from "@/lib/payments/paystack";
import { createPaymentSession as dodoCreateSession } from "@/lib/payments/dodopayments";
import { getBusinessDowngradeGraceDays } from "@/lib/business/limits";
import { requireFeatureEnabled } from "@/lib/manifest";

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

/**
 * BIZ-TIER-RACE: how long a pending business-upgrade payment session is
 * considered "still in progress" before we allow the user to start a new one.
 * Matches typical Paystack/DodoPayments checkout session lifetimes.
 */
const PENDING_PAYMENT_TTL_MINUTES = 30;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const upgradeTierSchema = z.object({
  tier: z.enum(["starter", "growth", "enterprise"]),
  paymentProvider: z.enum(["paystack", "dodopayments"]).optional(),
});

// ---------------------------------------------------------------------------
// PATCH /api/business/tier
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
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
    const { rows } = await db.query<{
      id: string;
      tier: string;
      pending_tier: string | null;
      pending_payment_ref: string | null;
      downgrade_to_tier: string | null;
    }>(
      `SELECT id, tier, pending_tier, pending_payment_ref, downgrade_to_tier FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (!rows[0]) throw notFound("No business account found");

    const currentTier = rows[0].tier.toLowerCase();

    // Requesting the current tier again cancels a pending downgrade (no-op otherwise).
    if (newTier === currentTier) {
      if (!rows[0].downgrade_to_tier) {
        throw badRequest(`Your business account is already on the ${currentTier} tier.`);
      }
      await db.query(
        `UPDATE business_accounts SET downgrade_to_tier = NULL, downgrade_effective_at = NULL, updated_at = NOW() WHERE id = $1`,
        [rows[0].id]
      );
      return NextResponse.json({
        success: true,
        data: { tier: currentTier, downgradeCancelled: true },
        error: null,
      });
    }

    // Downgrade — self-service, no payment. Keeps the current tier (and its
    // page slots / live sponsored quests) until the grace period elapses.
    if ((TIER_ORDER[newTier] ?? 0) < (TIER_ORDER[currentTier] ?? 0)) {
      const graceDays = await getBusinessDowngradeGraceDays();
      const { rows: updated } = await db.query<{ downgrade_effective_at: string }>(
        `UPDATE business_accounts
         SET downgrade_to_tier = $1, downgrade_effective_at = NOW() + ($2 || ' days')::interval,
             pending_tier = NULL, pending_payment_ref = NULL, updated_at = NOW()
         WHERE id = $3
         RETURNING downgrade_effective_at`,
        [newTier, String(graceDays), rows[0].id]
      );
      return NextResponse.json({
        success: true,
        data: {
          tier: currentTier,
          downgradeToTier: newTier,
          downgradeEffectiveAt: updated[0].downgrade_effective_at,
          message: `Your account stays on the ${currentTier} tier — with all its pages and live sponsored quests — until ${new Date(updated[0].downgrade_effective_at).toLocaleDateString()}. After that, extra pages beyond the ${newTier} tier's limit are deactivated and running sponsored quests are stopped.`,
        },
        error: null,
      });
    }

    // BIZ-TIER-RACE: reject a new upgrade request while a non-expired pending
    // payment already exists — otherwise the second request overwrites
    // pending_payment_ref before the first payment's webhook fires, so the
    // webhook's activation UPDATE (keyed on the now-stale ref) matches zero
    // rows and the tier is never actually activated.
    if (rows[0].pending_tier && rows[0].pending_payment_ref) {
      const { rows: pendingPaymentRows } = await db.query<{ id: string }>(
        `SELECT id FROM payments
         WHERE idempotency_key = $1
           AND status = 'pending'
           AND created_at > NOW() - INTERVAL '${PENDING_PAYMENT_TTL_MINUTES} minutes'
         LIMIT 1`,
        [rows[0].pending_payment_ref]
      );
      if (pendingPaymentRows[0]) {
        throw conflict(
          "You already have a business upgrade payment in progress. Complete or wait for it to expire before starting a new one.",
          "UPGRADE_ALREADY_PENDING"
        );
      }
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

    // Mark the tier change as pending before initiating payment. An upgrade
    // supersedes any scheduled downgrade.
    await db.query(
      `UPDATE business_accounts
       SET pending_tier = $1, pending_payment_ref = $2,
           downgrade_to_tier = NULL, downgrade_effective_at = NULL, updated_at = NOW()
       WHERE id = $3`,
      [newTier, reference, rows[0].id]
    );

    // Initiate payment
    let paymentUrl: string;
    let providerReference: string = reference;
    if (provider === "paystack") {
      const ps = await paystackInit(priceKobo, userEmail, reference, {
        userId,
        type: "business_upgrade",
        businessAccountId: rows[0].id,
        newTier,
        itemType: "business_upgrade",
      });
      paymentUrl = ps.authorization_url;
      providerReference = ps.reference ?? reference;
    } else {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
      const dd = await dodoCreateSession(priceKobo, "NGN", `${appUrl}/settings/business?upgraded=1`, {
        userId,
        type: "business_upgrade",
        businessAccountId: rows[0].id,
        newTier,
        itemType: "business_upgrade",
        reference,
      });
      paymentUrl = dd.payment_url;
      providerReference = dd.id ?? reference;
    }

    // Create a pending payment record so the webhook handler can locate it.
    // The webhook checks for this record before activating the tier upgrade.
    await db.query(
      `INSERT INTO payments
         (user_id, payment_type, amount_kobo, currency, provider,
          status, idempotency_key, provider_reference, metadata)
       VALUES ($1, 'business_upgrade', $2, 'NGN', $3,
               'pending', $4, $5, $6::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        userId,
        priceKobo,
        provider,
        reference,
        providerReference,
        JSON.stringify({
          businessAccountId: rows[0].id,
          newTier,
          itemType: "business_upgrade",
          userId,
        }),
      ]
    );

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
