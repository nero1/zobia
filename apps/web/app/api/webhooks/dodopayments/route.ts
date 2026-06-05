/**
 * app/api/webhooks/dodopayments/route.ts
 *
 * POST /api/webhooks/dodopayments
 *
 * Receives and processes payment completion events from DodoPayments.
 *
 * Handled events:
 *   - payment.succeeded  → credit coins or stars based on metadata.itemType
 *
 * Security:
 *   - HMAC-SHA256 signature verified via DODOPAYMENTS_API_KEY
 *   - Idempotency enforced via payments table (status check)
 *   - Always returns 200 to prevent DodoPayments retry storms
 *
 * On success, credits the user's balance and seeds 5% of payment
 * amount into the Creator Fund pool (creator_fund_balance_kobo).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/dodopayments";
import { db } from "@/lib/db";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { getCoinPurchaseBonus } from "@/lib/xp/trackMilestones";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DodoWebhookEvent {
  type: string;
  data: {
    id: string;
    status: string;
    amount: number;
    currency: string;
    metadata: {
      userId?: string;
      packId?: string;
      packName?: string;
      coinsGranted?: number;
      starsGranted?: number;
      itemType?: string;
      /** "subscription" when this is a plan subscription payment */
      type?: string;
      /** Plan name: plus | pro | max */
      planName?: string;
      planId?: string;
      interval?: string;
      /** Business account tier upgrade fields (PRD §17) */
      businessAccountId?: string;
      newTier?: string;
      reference?: string;
    };
    created_at?: string;
  };
}

// Monthly coin bonuses credited on subscription activation (PRD §12)
const SUBSCRIPTION_MONTHLY_BONUS: Record<string, number> = {
  plus: 50,
  pro: 200,
  max: 500,
};

// ---------------------------------------------------------------------------
// POST /api/webhooks/dodopayments
// ---------------------------------------------------------------------------

export const POST = async (req: NextRequest) => {
  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ received: true });
  }

  // Verify DodoPayments signature before processing
  const signature = req.headers.get("x-dodo-signature") ?? "";
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[webhooks/dodopayments] Invalid signature — ignoring event");
    return NextResponse.json({ received: true });
  }

  let event: DodoWebhookEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as DodoWebhookEvent;
  } catch {
    return NextResponse.json({ received: true });
  }

  // Only handle succeeded payment events
  if (event.type !== "payment.succeeded" || event.data.status !== "succeeded") {
    return NextResponse.json({ received: true });
  }

  const paymentId = event.data.id;
  const amountSmallestUnit = event.data.amount;
  const metadata = event.data.metadata ?? {};

  try {
    // Look up the pending payment record by provider reference
    const { rows: paymentRows } = await db.query<{
      id: string;
      user_id: string;
      status: string;
    }>(
      `SELECT id, user_id, status FROM payments
       WHERE provider_reference = $1
       LIMIT 1`,
      [paymentId]
    );

    const payment = paymentRows[0];
    if (!payment) {
      console.warn(`[webhooks/dodopayments] No payment record for id ${paymentId}`);
      return NextResponse.json({ received: true });
    }

    // Idempotency — skip if already processed
    if (payment.status === "success") {
      return NextResponse.json({ received: true });
    }

    const userId = metadata.userId ?? payment.user_id;
    const itemType = metadata.itemType ?? "coin_pack";
    const referenceId = `dodopayments:${paymentId}`;

    await db.transaction(async (tx) => {
      // Mark payment as successful
      await tx.query(
        `UPDATE payments SET status = 'success', updated_at = NOW() WHERE id = $1`,
        [payment.id]
      );

      // Credit coins or stars based on item type
      if (itemType === "star_pack" && metadata.starsGranted && metadata.starsGranted > 0) {
        await creditStars(
          userId,
          metadata.starsGranted,
          "purchase",
          referenceId,
          `DodoPayments purchase: ${metadata.packName ?? "Star Pack"}`,
          tx
        );
      } else if (metadata.type === "subscription" || itemType === "subscription") {
        // Subscription activation: credit monthly coin bonus and update subscription status
        const planName = (metadata.planName ?? "").toLowerCase();
        const bonusCoins = SUBSCRIPTION_MONTHLY_BONUS[planName] ?? 0;

        // Update subscription status to active
        await tx.query(
          `UPDATE subscriptions
           SET status = 'active', updated_at = NOW()
           WHERE user_id = $1 AND plan = $2 AND status != 'active'`,
          [userId, planName]
        );

        if (bonusCoins > 0) {
          await creditCoins(
            userId,
            bonusCoins,
            "monthly_plan_bonus",
            referenceId,
            `Monthly ${planName} plan bonus`,
            { plan: planName },
            tx
          );
        }
      } else if (metadata.coinsGranted && metadata.coinsGranted > 0) {
        // Apply Generosity L40 5% coin purchase bonus (PRD §7)
        const bonusPct = await getCoinPurchaseBonus(userId, db);
        const bonusCoins = bonusPct > 0 ? Math.floor(metadata.coinsGranted * bonusPct / 100) : 0;
        const totalCoins = metadata.coinsGranted + bonusCoins;

        await creditCoins(
          userId,
          totalCoins,
          "purchase",
          referenceId,
          bonusCoins > 0
            ? `DodoPayments purchase: ${metadata.packName ?? "Coin Pack"} (+${bonusCoins} Philanthropist bonus)`
            : `DodoPayments purchase: ${metadata.packName ?? "Coin Pack"}`,
          bonusCoins > 0 ? { bonusPct, bonusCoins } : undefined,
          tx
        );
      }

      // Business account tier upgrade (PRD §17)
      if (itemType === "business_upgrade" && metadata.businessAccountId && metadata.newTier) {
        await tx.query(
          `UPDATE business_accounts
           SET tier = $1,
               pending_tier = NULL,
               pending_payment_ref = NULL,
               tier_updated_at = NOW(),
               updated_at = NOW()
           WHERE id = $2
             AND pending_payment_ref = $3`,
          [metadata.newTier, metadata.businessAccountId, metadata.reference ?? paymentId]
        );
      }

      // Creator Fund seeding: 5% of payment amount → creator_fund_balance_kobo
      const fundContribution = Math.floor(amountSmallestUnit * 0.05);
      if (fundContribution > 0) {
        await tx.query(
          `INSERT INTO x_manifest (key, value, updated_at)
           VALUES ('creator_fund_balance_kobo', $1::TEXT, NOW())
           ON CONFLICT (key) DO UPDATE
           SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT,
               updated_at = NOW()`,
          [fundContribution]
        ).catch(() => {/* non-fatal */});
      }
    });
  } catch (err) {
    console.error("[webhooks/dodopayments] Processing error:", err);
    // Still return 200 to avoid DodoPayments retry storms
  }

  return NextResponse.json({ received: true });
};
