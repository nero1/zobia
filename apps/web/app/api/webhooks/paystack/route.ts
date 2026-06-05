/**
 * app/api/webhooks/paystack/route.ts
 *
 * POST /api/webhooks/paystack
 *
 * Receives and processes payment completion events from Paystack.
 *
 * Handled events:
 *   - charge.success  → credit coins or stars based on metadata.itemType
 *
 * Security:
 *   - HMAC-SHA512 signature verified via PAYSTACK_SECRET_KEY
 *   - Idempotency enforced via payments table (status check)
 *   - Always returns 200 to prevent Paystack retry storms
 *
 * On success, credits the user's balance and seeds 5% of payment
 * amount into the Creator Fund pool (creator_fund_balance_kobo).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/paystack";
import { db } from "@/lib/db";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaystackWebhookEvent {
  event: string;
  data: {
    id: number;
    status: string;
    reference: string;
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
    };
    paid_at: string;
  };
}

// Monthly coin bonuses credited on subscription activation (PRD §12)
const SUBSCRIPTION_MONTHLY_BONUS: Record<string, number> = {
  plus: 50,
  pro: 200,
  max: 500,
};

// ---------------------------------------------------------------------------
// POST /api/webhooks/paystack
// ---------------------------------------------------------------------------

export const POST = async (req: NextRequest) => {
  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ received: true });
  }

  // Verify Paystack signature before processing
  const signature = req.headers.get("x-paystack-signature") ?? "";
  if (!verifyWebhookSignature(rawBody, signature)) {
    // Return 200 to avoid Paystack retrying; just don't process
    console.warn("[webhooks/paystack] Invalid signature — ignoring event");
    return NextResponse.json({ received: true });
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as PaystackWebhookEvent;
  } catch {
    return NextResponse.json({ received: true });
  }

  // Only handle successful charge events
  if (event.event !== "charge.success" || event.data.status !== "success") {
    return NextResponse.json({ received: true });
  }

  const providerReference = event.data.reference;
  const amountKobo = event.data.amount;
  const metadata = event.data.metadata ?? {};

  try {
    // Look up the pending payment record
    const { rows: paymentRows } = await db.query<{
      id: string;
      user_id: string;
      status: string;
    }>(
      `SELECT id, user_id, status FROM payments
       WHERE provider_reference = $1
       LIMIT 1`,
      [providerReference]
    );

    const payment = paymentRows[0];
    if (!payment) {
      console.warn(`[webhooks/paystack] No payment record for reference ${providerReference}`);
      return NextResponse.json({ received: true });
    }

    // Idempotency — skip if already processed
    if (payment.status === "success") {
      return NextResponse.json({ received: true });
    }

    const userId = metadata.userId ?? payment.user_id;
    const itemType = metadata.itemType ?? "coin_pack";
    const referenceId = `paystack:${providerReference}`;

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
          `Paystack purchase: ${metadata.packName ?? "Star Pack"}`,
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
        await creditCoins(
          userId,
          metadata.coinsGranted,
          "purchase",
          referenceId,
          `Paystack purchase: ${metadata.packName ?? "Coin Pack"}`,
          undefined,
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
          [metadata.newTier, metadata.businessAccountId, providerReference]
        );
      }

      // Creator Fund seeding: 5% of payment amount → creator_fund_balance_kobo
      const fundContribution = Math.floor(amountKobo * 0.05);
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
    console.error("[webhooks/paystack] Processing error:", err);
    // Still return 200 to avoid Paystack retry storms
  }

  return NextResponse.json({ received: true });
};
