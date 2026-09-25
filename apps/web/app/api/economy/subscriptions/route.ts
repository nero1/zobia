export const dynamic = 'force-dynamic';

/**
 * /api/economy/subscriptions
 *
 * GET  — Returns the authenticated user's current subscription (if any)
 * POST — Subscribe to a plan
 *
 * Plans: free | plus | pro | max
 * Subscriptions are stored in the `subscriptions` table.
 * Plan assignment on the `users` table is updated atomically.
 *
 * @module app/api/economy/subscriptions
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, conflict, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { initializePayment } from "@/lib/payments";
import { serializeComputedAmount, type ComputedAmount } from "@/lib/payments/crypto";
import { randomUUID } from "crypto";
import { env } from "@/lib/env";
import { enforcePaymentContext, getUserIsNigeria } from "@/lib/payments/contextSettings";
import { grantFreePayment } from "@/lib/payments/freeGrant";

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * GET /api/economy/subscriptions
 *
 * Returns the user's active subscription, or null if on the free plan.
 */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const orm = await getDb();

    const rows = await orm
      .select({
        id: schema.subscriptions.id,
        userId: schema.subscriptions.userId,
        plan: schema.subscriptions.plan,
        billingPeriod: schema.subscriptions.billingPeriod,
        status: schema.subscriptions.status,
        startsAt: schema.subscriptions.startsAt,
        endsAt: schema.subscriptions.endsAt,
        cancelledAt: schema.subscriptions.cancelledAt,
        provider: schema.subscriptions.provider,
        providerSubscriptionId: schema.subscriptions.providerSubscriptionId,
        createdAt: schema.subscriptions.createdAt,
      })
      .from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.userId, userId), inArray(schema.subscriptions.status, ["active", "cancelled"])))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(1);

    const subscription = rows[0] ?? null;

    // Also return available plans for the subscribe flow
    const plans = await orm
      .select({
        id: schema.subscriptionPlans.id,
        plan: schema.subscriptionPlans.plan,
        name: schema.subscriptionPlans.name,
        priceKobo: schema.subscriptionPlans.priceKobo,
        currency: schema.subscriptionPlans.currency,
        interval: schema.subscriptionPlans.interval,
      })
      .from(schema.subscriptionPlans)
      .where(eq(schema.subscriptionPlans.isActive, true))
      .orderBy(schema.subscriptionPlans.priceKobo);

    return NextResponse.json({
      currentSubscription: subscription
        ? {
            id: subscription.id,
            plan: subscription.plan,
            interval: subscription.billingPeriod,
            status: subscription.status,
            currentPeriodStart: subscription.startsAt,
            currentPeriodEnd: subscription.endsAt,
            cancelledAt: subscription.cancelledAt,
            // "google_play" | "paystack" | "crypto" — Android uses this to
            // route cancellation through the Play Store subscription center
            // instead of our own DELETE, since only Play can actually stop
            // a Play-billed recurring charge (see routes/settings/subscription.tsx).
            provider: subscription.provider,
            providerSubscriptionId: subscription.providerSubscriptionId,
            createdAt: subscription.createdAt,
          }
        : null,
      availablePlans: plans.map((p) => ({
        id: p.id,
        plan: p.plan,
        name: p.name,
        priceKobo: Number(p.priceKobo),
        currency: p.currency,
        interval: p.interval,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

const SubscribeSchema = z.object({
  /**
   * ID of the subscription plan from subscription_plans table.
   * If billingCycle is provided instead, the API resolves the correct planId.
   */
  planId: z.string().uuid("planId must be a valid UUID").optional(),
  /** PRD §3: alternative to planId — provide plan + billing cycle and we resolve. */
  plan: z.enum(["plus", "pro", "max"]).optional(),
  /** PRD §3: 'monthly' or 'annual' (annual = 10×monthly price, 2 months free). */
  billingCycle: z.enum(["monthly", "annual"]).optional(),
  /** Alias for billingCycle — accepted for backwards compatibility with older clients. */
  interval: z.enum(["monthly", "annual"]).optional(),
  paymentProvider: z.enum(["paystack", "crypto"]).optional(),
  /** Required when paymentProvider === "crypto". */
  cryptoCurrency: z.enum(["JAGA", "BNB", "SOL"]).optional(),
}).transform((d) => ({
  planId: d.planId,
  plan: d.plan,
  paymentProvider: d.paymentProvider,
  cryptoCurrency: d.cryptoCurrency,
  billingCycle: d.billingCycle ?? d.interval,
})).refine(
  (d) => d.planId !== undefined || (d.plan !== undefined && d.billingCycle !== undefined),
  { message: "Provide either planId or both plan and billingCycle" }
);

/**
 * POST /api/economy/subscriptions
 *
 * Body: { planId: string }
 * Initiates a subscription payment flow. Returns paymentUrl for redirect.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await validateBody(req, SubscribeSchema);
    const userId = auth.user.sub;
    const orm = await getDb();

    // Resolve plan — either by planId or by plan+billingCycle
    const planWhere = body.planId
      ? eq(schema.subscriptionPlans.id, body.planId)
      : and(
          eq(schema.subscriptionPlans.plan, body.plan!),
          eq(schema.subscriptionPlans.interval, body.billingCycle!),
          eq(schema.subscriptionPlans.isActive, true)
        );

    const planRows = await orm
      .select({
        id: schema.subscriptionPlans.id,
        plan: schema.subscriptionPlans.plan,
        name: schema.subscriptionPlans.name,
        priceKobo: schema.subscriptionPlans.priceKobo,
        currency: schema.subscriptionPlans.currency,
        interval: schema.subscriptionPlans.interval,
        isActive: schema.subscriptionPlans.isActive,
      })
      .from(schema.subscriptionPlans)
      .where(planWhere)
      .limit(1);

    if (!planRows[0]) {
      throw notFound("Subscription plan not found");
    }

    const planRow = planRows[0];
    const plan = { ...planRow, priceKobo: Number(planRow.priceKobo) };

    if (!plan.isActive) {
      throw badRequest("This subscription plan is not currently available");
    }

    // Check if user already has an active subscription to this plan
    const existing = await orm
      .select({ id: schema.subscriptions.id })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.userId, userId),
          eq(schema.subscriptions.plan, plan.plan),
          eq(schema.subscriptions.status, "active")
        )
      )
      .limit(1);

    if (existing[0]) {
      throw conflict("You already have an active subscription to this plan", "ALREADY_SUBSCRIBED");
    }

    // Load user email
    const userRows = await orm
      .select({ email: schema.users.email, username: schema.users.username })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!userRows[0]) {
      throw badRequest("User not found");
    }

    const user = userRows[0];
    const email = user.email ?? `${user.username}@zobia.app`;
    const idempotencyKey = `subscription-${userId}-${plan.id}-${randomUUID()}`;

    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/settings/subscription/callback`;

    const isNigeria = await getUserIsNigeria(userId);
    const decision = await enforcePaymentContext("subscription", isNigeria, body.paymentProvider, body.cryptoCurrency);

    const metadata = {
      userId,
      planId: plan.id,
      planName: plan.plan,
      interval: plan.interval,
      type: "subscription",
      itemType: "subscription",
      ...(!decision.isFree && decision.provider === "crypto" ? { cryptoCurrency: decision.cryptoCurrency } : {}),
    };

    if (decision.isFree) {
      await grantFreePayment({
        userId,
        paymentType: "subscription",
        amountKobo: plan.priceKobo,
        currency: plan.currency,
        idempotencyKey,
        metadata: metadata as never,
      });
      return NextResponse.json({
        paymentUrl: "",
        paymentReference: idempotencyKey,
        free: true,
        plan: { id: plan.id, plan: plan.plan, name: plan.name, priceKobo: plan.priceKobo, currency: plan.currency, interval: plan.interval },
      });
    }

    const provider = decision.provider;

    const paymentResult = await initializePayment(
      plan.priceKobo,
      plan.currency,
      email,
      idempotencyKey,
      metadata,
      returnUrl,
      provider
    );

    const metadataWithUrl = { ...metadata, payment_url: paymentResult.paymentUrl };
    const computed = provider === "crypto" ? (paymentResult.raw as ComputedAmount) : null;

    // Store pending payment
    await orm.insert(schema.payments).values({
      userId,
      paymentType: "subscription",
      amountKobo: planRow.priceKobo,
      currency: plan.currency,
      provider,
      status: "pending",
      idempotencyKey,
      providerReference: paymentResult.providerReference,
      metadata: metadataWithUrl,
      chain: computed?.chain ?? null,
      tokenSymbol: computed?.currency ?? null,
      walletAddress: computed?.receivingAddress ?? null,
      expectedTokenAmount: computed ? computed.expectedBaseUnits.toString() : null,
    });

    return NextResponse.json({
      paymentUrl: paymentResult.paymentUrl,
      paymentReference: paymentResult.providerReference,
      crypto: computed ? serializeComputedAmount(computed) : null,
      plan: {
        id: plan.id,
        plan: plan.plan,
        name: plan.name,
        priceKobo: plan.priceKobo,
        currency: plan.currency,
        interval: plan.interval,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
