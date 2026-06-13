export const dynamic = 'force-dynamic';

/**
 * /api/economy/subscriptions/[subscriptionId]
 *
 * DELETE — Cancel a subscription (sets cancelled_at, keeps active until period end)
 * PUT    — Change the subscription plan (upgrade or downgrade)
 *
 * @module app/api/economy/subscriptions/[subscriptionId]
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, forbidden, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Shared: load and authorize subscription
// ---------------------------------------------------------------------------

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  ends_at: string | null;
  cancelled_at: string | null;
}

async function loadOwnSubscription(
  subscriptionId: string,
  userId: string
): Promise<SubscriptionRow> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT id, user_id, plan, status, ends_at, cancelled_at
     FROM subscriptions
     WHERE id = $1 LIMIT 1`,
    [subscriptionId]
  );

  if (!rows[0]) {
    throw notFound("Subscription not found");
  }

  if (rows[0].user_id !== userId) {
    throw forbidden("You do not own this subscription");
  }

  return rows[0];
}

// ---------------------------------------------------------------------------
// DELETE handler — cancel subscription
// ---------------------------------------------------------------------------

/**
 * DELETE /api/economy/subscriptions/[subscriptionId]
 *
 * Cancels the subscription at the end of the current billing period.
 * The user retains their plan benefits until current_period_end.
 */
export const DELETE = withAuth(
  async (
    _req: NextRequest,
    { auth, params }: { params: { subscriptionId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const userId = auth.user.sub;
      const { subscriptionId } = params;

      const subscription = await loadOwnSubscription(subscriptionId, userId);

      if (subscription.status === "cancelled") {
        throw badRequest("Subscription is already cancelled");
      }

      // Mark as cancelled — access continues until current_period_end
      await db.query(
        `UPDATE subscriptions
         SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [subscriptionId]
      );

      return NextResponse.json({
        success: true,
        message: "Subscription cancelled. You retain access until your current period ends.",
        accessUntil: subscription.ends_at,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT handler — change plan
// ---------------------------------------------------------------------------

const ChangePlanSchema = z.object({
  /** ID of the new subscription plan. */
  newPlanId: z.string().uuid("newPlanId must be a valid UUID"),
});

interface PlanRow {
  id: string;
  plan: string;
  name: string;
  price_kobo: number;
}

/**
 * PUT /api/economy/subscriptions/[subscriptionId]
 *
 * Body: { newPlanId: string }
 * Changes the user's subscription plan. Effective immediately (no prorating in v1).
 */
export const PUT = withAuth(
  async (
    req: NextRequest,
    { auth, params }: { params: { subscriptionId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const userId = auth.user.sub;
      const { subscriptionId } = params;

      const body = await validateBody(req, ChangePlanSchema);
      const subscription = await loadOwnSubscription(subscriptionId, userId);

      if (subscription.status !== "active" && subscription.status !== "trialing") {
        throw badRequest("Can only change an active subscription");
      }

      // Load the new plan
      const { rows: planRows } = await db.query<PlanRow>(
        `SELECT id, plan, name, price_kobo FROM subscription_plans
         WHERE id = $1 AND is_active = TRUE LIMIT 1`,
        [body.newPlanId]
      );

      if (!planRows[0]) {
        throw notFound("New subscription plan not found");
      }

      const newPlan = planRows[0];

      if (newPlan.plan === subscription.plan) {
        throw badRequest("Already on this plan");
      }

      await db.transaction(async (tx) => {
        // Update the subscription plan
        await tx.query(
          `UPDATE subscriptions
           SET plan = $1, updated_at = NOW()
           WHERE id = $2`,
          [newPlan.plan, subscriptionId]
        );

        // Update user's plan column
        await tx.query(
          `UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2`,
          [newPlan.plan, userId]
        );
      });

      return NextResponse.json({
        success: true,
        subscription: {
          id: subscriptionId,
          plan: newPlan.plan,
          planName: newPlan.name,
        },
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
