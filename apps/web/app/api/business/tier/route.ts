export const dynamic = 'force-dynamic';

/**
 * app/api/business/tier/route.ts
 *
 * PATCH /api/business/tier
 *
 * Upgrade or downgrade the authenticated user's business account tier.
 * Body: { tier: "starter" | "growth" | "enterprise", paymentProvider?: "paystack" | "crypto", cryptoCurrency?: "JAGA" | "BNB" | "SOL" }
 *
 * Upgrade flow (PRD §17):
 *   1. Validate the requested tier is higher than the current tier.
 *   2. Determine tier price from x_manifest (admin-configurable).
 *   3. Initiate payment with Paystack (Nigeria) or crypto (international —
 *      user-initiated on-chain transfer, see lib/payments/crypto/).
 *   4. Store pending_tier + pending_payment_ref on the business account record.
 *   5. Return { paymentUrl } (paystack) or { crypto } details — client
 *      redirects to checkout, or drives the wallet-connect flow.
 *   6. On charge.success webhook (paystack) or on-chain verification
 *      (crypto), the tier is activated.
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
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment } from "@/lib/payments";
import { applyCryptoComputedAmount, serializeComputedAmount, type ComputedAmount } from "@/lib/payments/crypto";
import { getBusinessDowngradeGraceDays, getBusinessTierPriceKobo } from "@/lib/business/limits";
import { requireFeatureEnabled } from "@/lib/manifest";
import { enforcePaymentContext, getUserIsNigeria } from "@/lib/payments/contextSettings";
import { processChargeSuccess } from "@/lib/payments/paystackWebhookHandler";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_ORDER: Record<string, number> = {
  starter: 1,
  growth: 2,
  enterprise: 3,
};

/**
 * BIZ-TIER-RACE: how long a pending business-upgrade payment session is
 * considered "still in progress" before we allow the user to start a new one.
 * Matches typical Paystack checkout session lifetimes.
 */
const PENDING_PAYMENT_TTL_MINUTES = 30;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const upgradeTierSchema = z.object({
  tier: z.enum(["starter", "growth", "enterprise"]),
  paymentProvider: z.enum(["paystack", "crypto"]).optional(),
  cryptoCurrency: z.enum(["JAGA", "BNB", "SOL"]).optional(),
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

    const orm = await getDb();

    // Load user record (we need their email for the payment provider)
    const userRows = await orm
      .select({ id: schema.users.id, email: schema.users.email, plan: schema.users.plan })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!userRows[0]) throw notFound("User not found");

    const userEmail = userRows[0].email ?? `${userId}@zobia.placeholder`;

    // Fetch current business account
    const rows = await orm
      .select({
        id: schema.businessAccounts.id,
        tier: schema.businessAccounts.tier,
        pendingTier: schema.businessAccounts.pendingTier,
        pendingPaymentRef: schema.businessAccounts.pendingPaymentRef,
        downgradeToTier: schema.businessAccounts.downgradeToTier,
      })
      .from(schema.businessAccounts)
      .where(eq(schema.businessAccounts.userId, userId))
      .limit(1);
    if (!rows[0]) throw notFound("No business account found");

    const currentTier = rows[0].tier.toLowerCase();

    // Requesting the current tier again cancels a pending downgrade (no-op otherwise).
    if (newTier === currentTier) {
      if (!rows[0].downgradeToTier) {
        throw badRequest(`Your business account is already on the ${currentTier} tier.`);
      }
      await orm
        .update(schema.businessAccounts)
        .set({ downgradeToTier: null, downgradeEffectiveAt: null, updatedAt: new Date() })
        .where(eq(schema.businessAccounts.id, rows[0].id));
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
      const updated = await orm
        .update(schema.businessAccounts)
        .set({
          downgradeToTier: newTier,
          downgradeEffectiveAt: sql`NOW() + (${String(graceDays)} || ' days')::interval`,
          pendingTier: null,
          pendingPaymentRef: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.businessAccounts.id, rows[0].id))
        .returning({ downgradeEffectiveAt: schema.businessAccounts.downgradeEffectiveAt });
      const downgradeEffectiveAt = updated[0].downgradeEffectiveAt as Date;
      return NextResponse.json({
        success: true,
        data: {
          tier: currentTier,
          downgradeToTier: newTier,
          downgradeEffectiveAt,
          message: `Your account stays on the ${currentTier} tier — with all its pages and live sponsored quests — until ${downgradeEffectiveAt.toLocaleDateString()}. After that, extra pages beyond the ${newTier} tier's limit are deactivated and running sponsored quests are stopped.`,
        },
        error: null,
      });
    }

    // BIZ-TIER-RACE: reject a new upgrade request while a non-expired pending
    // payment already exists — otherwise the second request overwrites
    // pending_payment_ref before the first payment's webhook fires, so the
    // webhook's activation UPDATE (keyed on the now-stale ref) matches zero
    // rows and the tier is never actually activated.
    if (rows[0].pendingTier && rows[0].pendingPaymentRef) {
      const ttlCutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MINUTES * 60_000);
      const pendingPaymentRows = await orm
        .select({ id: schema.payments.id, createdAt: schema.payments.createdAt })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.idempotencyKey, rows[0].pendingPaymentRef),
            eq(schema.payments.status, "pending"),
            gt(schema.payments.createdAt, ttlCutoff)
          )
        )
        .limit(1);
      if (pendingPaymentRows[0]) {
        const expiresAt = new Date(
          (pendingPaymentRows[0].createdAt as Date).getTime() + PENDING_PAYMENT_TTL_MINUTES * 60_000
        ).toISOString();
        throw conflict(
          `You already have a business upgrade payment in progress. Complete it, cancel it, or wait for it to expire (expires after ${PENDING_PAYMENT_TTL_MINUTES} minutes) before starting a new one.`,
          "UPGRADE_ALREADY_PENDING",
          { expiresAt, ttlMinutes: PENDING_PAYMENT_TTL_MINUTES }
        );
      }
    }

    // Resolve tier price from x_manifest (admin-configurable)
    const priceKobo = await getBusinessTierPriceKobo(newTier);

    if (priceKobo <= 0) {
      throw badRequest("Invalid tier price configuration");
    }

    // Determine payment provider — re-validated server-side against the
    // admin-configured payment_context_settings for "business_tier".
    const isNigeria = await getUserIsNigeria(userId);
    const decision = await enforcePaymentContext("business_tier", isNigeria, paymentProvider, body.cryptoCurrency);

    // Generate idempotency reference
    const reference = `biz-tier-${rows[0].id}-${newTier}-${randomUUID().slice(0, 8)}`;

    // Mark the tier change as pending before initiating payment. An upgrade
    // supersedes any scheduled downgrade.
    await orm
      .update(schema.businessAccounts)
      .set({
        pendingTier: newTier,
        pendingPaymentRef: reference,
        downgradeToTier: null,
        downgradeEffectiveAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.businessAccounts.id, rows[0].id));

    // Initiate payment
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
    const metadata = {
      userId,
      type: "business_upgrade",
      businessAccountId: rows[0].id,
      newTier,
      itemType: "business_upgrade",
      ...(!decision.isFree && decision.provider === "crypto" ? { cryptoCurrency: decision.cryptoCurrency } : {}),
    };

    if (decision.isFree) {
      const freeRows = await orm
        .insert(schema.payments)
        .values({
          userId,
          paymentType: "business_upgrade",
          amountKobo: BigInt(priceKobo),
          currency: "NGN",
          provider: "free",
          status: "pending",
          idempotencyKey: reference,
          providerReference: reference,
          metadata,
        })
        .onConflictDoNothing({ target: schema.payments.idempotencyKey })
        .returning({ id: schema.payments.id });
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
      return NextResponse.json({
        success: true,
        data: { paymentUrl: "", reference, tier: newTier, priceKobo, free: true, message: `Your ${newTier} business account is now active (free)` },
        error: null,
      });
    }

    const provider = decision.provider;
    const returnUrl =
      provider === "paystack"
        ? `${appUrl}/settings/business/callback`
        : `${appUrl}/settings/business?upgraded=1`;

    const result = await initializePayment(priceKobo, "NGN", userEmail, reference, metadata, returnUrl, provider);
    const paymentUrl = result.paymentUrl;
    const providerReference = result.providerReference ?? reference;
    const computed = provider === "crypto" ? (result.raw as ComputedAmount) : null;

    // Create a pending payment record so the webhook handler can locate it.
    // The webhook checks for this record before activating the tier upgrade.
    const paymentRows = await orm
      .insert(schema.payments)
      .values({
        userId,
        paymentType: "business_upgrade",
        amountKobo: BigInt(priceKobo),
        currency: "NGN",
        provider,
        status: "pending",
        idempotencyKey: reference,
        providerReference,
        metadata: {
          businessAccountId: rows[0].id,
          newTier,
          itemType: "business_upgrade",
          userId,
        },
      })
      .onConflictDoNothing({ target: schema.payments.idempotencyKey })
      .returning({ id: schema.payments.id });
    if (computed && paymentRows[0]) {
      await applyCryptoComputedAmount(paymentRows[0].id, computed);
    }

    return NextResponse.json({
      success: true,
      data: {
        paymentUrl,
        reference,
        tier: newTier,
        priceKobo,
        crypto: computed ? serializeComputedAmount(computed) : null,
        message: `Complete payment to activate your ${newTier} business account`,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
