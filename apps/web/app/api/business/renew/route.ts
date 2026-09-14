export const dynamic = 'force-dynamic';

/**
 * app/api/business/renew/route.ts
 *
 * POST /api/business/renew
 *
 * Business Account checkout (Paystack/crypto) is a one-off charge —
 * there is no native recurring subscription behind it, unlike the personal
 * Plus/Pro/Max flow. So the account's billing period (business_accounts.
 * current_period_ends_at) needs a manual "pay for another period" action
 * once it's nearing expiry or has lapsed into 'grace' — this is that action.
 * Charges the account's *current* tier price again; use PATCH /api/business/tier
 * instead to change tier. On success (webhook), current_period_ends_at is
 * extended by BUSINESS_BILLING_PERIOD_DAYS and status returns to 'active'.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment } from "@/lib/payments";
import { applyCryptoComputedAmount, serializeComputedAmount, type ComputedAmount } from "@/lib/payments/crypto";
import { getBusinessTierPriceKobo } from "@/lib/business/limits";
import { enforcePaymentContext, getUserIsNigeria } from "@/lib/payments/contextSettings";
import { processChargeSuccess } from "@/lib/payments/paystackWebhookHandler";

/** Mirrors PENDING_PAYMENT_TTL_MINUTES in app/api/business/route.ts and tier/route.ts. */
const PENDING_PAYMENT_TTL_MINUTES = 30;

const renewSchema = z.object({
  paymentProvider: z.enum(["paystack", "crypto"]).optional(),
  cryptoCurrency: z.enum(["JAGA", "BNB", "SOL"]).optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, renewSchema);

    const { rows: userRows } = await db.query<{ email: string | null }>(
      `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!userRows[0]) throw notFound("User not found");
    const userEmail = userRows[0].email ?? `${userId}@zobia.placeholder`;

    const { rows } = await db.query<{ id: string; tier: string }>(
      `SELECT id, tier FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (!rows[0]) throw notFound("No business account found");
    const businessAccountId = rows[0].id;
    const tier = rows[0].tier;

    // Reuse the same pending-payment guard as signup/upgrade (BIZ-SIGNUP-RACE).
    const reference = `biz-renew-${businessAccountId}-${randomUUID().slice(0, 8)}`;
    const priceKobo = await getBusinessTierPriceKobo(tier);
    if (priceKobo <= 0) throw badRequest("Invalid tier price configuration");

    const isNigeria = await getUserIsNigeria(userId);
    const decision = await enforcePaymentContext("business_renew", isNigeria, body.paymentProvider, body.cryptoCurrency);
    const metadata = {
      userId,
      businessAccountId,
      type: "business_renewal",
      itemType: "business_renewal",
      ...(!decision.isFree && decision.provider === "crypto" ? { cryptoCurrency: decision.cryptoCurrency } : {}),
    };

    if (decision.isFree) {
      const { rows: freeRows } = await db.query<{ id: string }>(
        `INSERT INTO payments
           (user_id, payment_type, amount_kobo, currency, provider, status, idempotency_key, provider_reference, metadata)
         VALUES ($1, 'business_upgrade', $2, 'NGN', 'free', 'pending', $3, $3, $4::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [userId, priceKobo, reference, JSON.stringify(metadata)]
      );
      if (freeRows[0]) {
        await processChargeSuccess({
          reference,
          status: "success",
          amount: 0,
          currency: "NGN",
          customer: { email: userEmail },
          metadata,
          paid_at: new Date().toISOString(),
        } as unknown as Parameters<typeof processChargeSuccess>[0]);
      }
      return NextResponse.json(
        { success: true, data: { paymentUrl: "", reference, tier, priceKobo, free: true }, error: null },
        { status: 200 }
      );
    }

    const provider = decision.provider;

    const { rows: reservedRows } = await db.query<{ id: string }>(
      `INSERT INTO payments
         (user_id, payment_type, amount_kobo, currency, provider,
          status, idempotency_key, provider_reference, metadata)
       SELECT $1, 'business_upgrade', $2, 'NGN', $3, 'pending', $4, $4, $5::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM payments
         WHERE user_id = $1
           AND payment_type = 'business_upgrade'
           AND status = 'pending'
           AND metadata->>'itemType' IN ('business_signup', 'business_upgrade', 'business_renewal')
           AND created_at > NOW() - INTERVAL '${PENDING_PAYMENT_TTL_MINUTES} minutes'
       )
       RETURNING id`,
      [userId, priceKobo, provider, reference, JSON.stringify(metadata)]
    );
    if (!reservedRows[0]) {
      throw conflict(
        `You already have a business payment in progress. Complete it, cancel it, or wait for it to expire (expires after ${PENDING_PAYMENT_TTL_MINUTES} minutes) before starting a new one.`,
        "RENEWAL_ALREADY_PENDING",
        { ttlMinutes: PENDING_PAYMENT_TTL_MINUTES }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
    const returnUrl =
      provider === "paystack" ? `${appUrl}/settings/business/callback` : `${appUrl}/settings/business?renewed=1`;
    const result = await initializePayment(priceKobo, "NGN", userEmail, reference, metadata, returnUrl, provider);
    const paymentUrl = result.paymentUrl;
    const providerReference = result.providerReference ?? reference;
    const computed = provider === "crypto" ? (result.raw as ComputedAmount) : null;

    if (providerReference !== reference) {
      await db.query(`UPDATE payments SET provider_reference = $1 WHERE id = $2`, [providerReference, reservedRows[0].id]);
    }
    if (computed) {
      await applyCryptoComputedAmount(reservedRows[0].id, computed);
    }

    return NextResponse.json(
      { success: true, data: { paymentUrl, reference, tier, priceKobo, crypto: computed ? serializeComputedAmount(computed) : null }, error: null },
      { status: 202 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
