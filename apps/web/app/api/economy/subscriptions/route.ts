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
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { initializePayment } from "@/lib/payments";
import { randomUUID } from "crypto";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Plan = "free" | "plus" | "pro" | "max";

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: Plan;
  status: "active" | "cancelled" | "past_due" | "trialing";
  current_period_start: string;
  current_period_end: string | null;
  cancelled_at: string | null;
  provider_subscription_id: string | null;
  store_item_id: string | null;
  created_at: string;
}

interface SubscriptionPlanRow {
  id: string;
  plan: Plan;
  name: string;
  price_kobo: number;
  currency: string;
  interval: "monthly" | "annual";
  is_active: boolean;
}

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

    const { rows } = await db.query<SubscriptionRow>(
      `SELECT id, user_id, plan, status, current_period_start,
              current_period_end, cancelled_at, provider_subscription_id, created_at
       FROM subscriptions
       WHERE user_id = $1 AND status IN ('active', 'trialing')
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    const subscription = rows[0] ?? null;

    // Also return available plans for the subscribe flow
    const { rows: plans } = await db.query<SubscriptionPlanRow>(
      `SELECT id, plan, name, price_kobo, currency, interval, is_active
       FROM subscription_plans
       WHERE is_active = TRUE
       ORDER BY price_kobo ASC`
    );

    return NextResponse.json({
      currentSubscription: subscription
        ? {
            id: subscription.id,
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.current_period_start,
            currentPeriodEnd: subscription.current_period_end,
            cancelledAt: subscription.cancelled_at,
            createdAt: subscription.created_at,
          }
        : null,
      availablePlans: plans.map((p) => ({
        id: p.id,
        plan: p.plan,
        name: p.name,
        priceKobo: p.price_kobo,
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
}).refine(
  (d) => d.planId !== undefined || (d.plan !== undefined && d.billingCycle !== undefined),
  { message: "Provide either planId or both plan and billingCycle" }
);

/**
 * POST /api/economy/subscriptions
 *
 * Body: { planId: string }
 * Initiates a subscription payment flow. Returns paymentUrl for redirect.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, SubscribeSchema);
    const userId = auth.user.sub;

    // Resolve plan — either by planId or by plan+billingCycle
    let planQuery: string;
    let planParams: string[];
    if (body.planId) {
      planQuery = `SELECT id, plan, name, price_kobo, currency, interval, is_active
                   FROM subscription_plans WHERE id = $1 LIMIT 1`;
      planParams = [body.planId];
    } else {
      // PRD §3: annual = 10×monthly price (2 months free)
      planQuery = `SELECT id, plan, name, price_kobo, currency, interval, is_active
                   FROM subscription_plans
                   WHERE plan = $1 AND interval = $2 AND is_active = TRUE
                   LIMIT 1`;
      planParams = [body.plan!, body.billingCycle!];
    }

    const { rows: planRows } = await db.query<SubscriptionPlanRow>(planQuery, planParams);

    if (!planRows[0]) {
      throw notFound("Subscription plan not found");
    }

    const plan = planRows[0];

    if (!plan.is_active) {
      throw badRequest("This subscription plan is not currently available");
    }

    // Check if user already has an active subscription to this plan
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM subscriptions
       WHERE user_id = $1 AND plan = $2 AND status = 'active'
       LIMIT 1`,
      [userId, plan.plan]
    );

    if (existing[0]) {
      throw badRequest("You already have an active subscription to this plan", "ALREADY_SUBSCRIBED");
    }

    // Load user email
    const { rows: userRows } = await db.query<{ email: string | null; username: string }>(
      `SELECT email, username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!userRows[0]) {
      throw badRequest("User not found");
    }

    const user = userRows[0];
    const email = user.email ?? `${user.username}@zobia.app`;
    const idempotencyKey = `subscription:${userId}:${plan.id}:${randomUUID()}`;

    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/settings/subscription/callback`;
    const metadata = {
      userId,
      planId: plan.id,
      planName: plan.plan,
      interval: plan.interval,
      type: "subscription",
      itemType: "subscription",
    };

    const paymentResult = await initializePayment(
      plan.price_kobo,
      plan.currency,
      email,
      idempotencyKey,
      metadata,
      returnUrl
    );

    // Store pending payment
    await db.query(
      `INSERT INTO payments
         (user_id, store_item_id, amount_kobo, currency, status,
          idempotency_key, provider_reference, payment_url, metadata)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)`,
      [
        userId,
        plan.id,
        plan.price_kobo,
        plan.currency,
        idempotencyKey,
        paymentResult.providerReference,
        paymentResult.paymentUrl,
        JSON.stringify(metadata),
      ]
    );

    return NextResponse.json({
      paymentUrl: paymentResult.paymentUrl,
      paymentReference: paymentResult.providerReference,
      plan: {
        id: plan.id,
        plan: plan.plan,
        name: plan.name,
        priceKobo: plan.price_kobo,
        currency: plan.currency,
        interval: plan.interval,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
