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
import { and, eq, sql } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, forbidden, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Shared: load and authorize subscription
// ---------------------------------------------------------------------------

interface SubscriptionRow {
  id: string;
  userId: string;
  plan: string;
  status: string;
  endsAt: Date | null;
  cancelledAt: Date | null;
}

async function loadOwnSubscription(
  orm: Awaited<ReturnType<typeof getDb>>,
  subscriptionId: string,
  userId: string
): Promise<SubscriptionRow> {
  const rows = await orm
    .select({
      id: schema.subscriptions.id,
      userId: schema.subscriptions.userId,
      plan: schema.subscriptions.plan,
      status: schema.subscriptions.status,
      endsAt: schema.subscriptions.endsAt,
      cancelledAt: schema.subscriptions.cancelledAt,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
    .limit(1);

  if (!rows[0]) {
    throw notFound("Subscription not found");
  }

  if (rows[0].userId !== userId) {
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
      const orm = await getDb();

      const subscription = await loadOwnSubscription(orm, subscriptionId, userId);

      if (subscription.status === "cancelled") {
        throw badRequest("Subscription is already cancelled");
      }

      // Mark as cancelled — access continues until current_period_end
      await orm
        .update(schema.subscriptions)
        .set({ status: "cancelled", cancelledAt: sql`NOW()`, updatedAt: sql`NOW()` })
        .where(eq(schema.subscriptions.id, subscriptionId));

      logger.info(
        { userId, subscriptionId, plan: subscription.plan, endsAt: subscription.endsAt },
        "[subscriptions] cancelled"
      );

      return NextResponse.json({
        success: true,
        message: "Subscription cancelled. You retain access until your current period ends.",
        accessUntil: subscription.endsAt,
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
      const orm = await getDb();

      const body = await validateBody(req, ChangePlanSchema);
      const subscription = await loadOwnSubscription(orm, subscriptionId, userId);

      if (subscription.status !== "active" && subscription.status !== "trialing") {
        throw badRequest("Can only change an active subscription");
      }

      // Load the new plan
      const planRows = await orm
        .select({
          id: schema.subscriptionPlans.id,
          plan: schema.subscriptionPlans.plan,
          name: schema.subscriptionPlans.name,
          priceKobo: schema.subscriptionPlans.priceKobo,
        })
        .from(schema.subscriptionPlans)
        .where(and(eq(schema.subscriptionPlans.id, body.newPlanId), eq(schema.subscriptionPlans.isActive, true)))
        .limit(1);

      if (!planRows[0]) {
        throw notFound("New subscription plan not found");
      }

      const newPlan = planRows[0];

      if (newPlan.plan === subscription.plan) {
        throw badRequest("Already on this plan");
      }

      await orm.transaction(async (tx) => {
        // Update the subscription plan
        await tx
          .update(schema.subscriptions)
          .set({ plan: newPlan.plan, updatedAt: sql`NOW()` })
          .where(eq(schema.subscriptions.id, subscriptionId));

        // Update user's plan column
        await tx
          .update(schema.users)
          .set({ plan: newPlan.plan, updatedAt: sql`NOW()` })
          .where(eq(schema.users.id, userId));
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
