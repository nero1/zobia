/**
 * POST /api/economy/webhooks/paystack
 *
 * Paystack payment event webhook handler.
 *
 * Security model:
 *   - Validates HMAC-SHA512 signature before ANY processing
 *   - Idempotent: skips duplicate events using provider_reference uniqueness
 *   - Returns 200 immediately; coin credits happen synchronously but atomically
 *
 * Supported events:
 *   - charge.success → credits coins / stars to the purchasing user
 *
 * @module app/api/economy/webhooks/paystack
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/paystack";
import { db } from "@/lib/db";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { awardReferralCommissions } from "@/lib/referrals/commissions";

// ---------------------------------------------------------------------------
// Paystack webhook event types (subset)
// ---------------------------------------------------------------------------

interface PaystackChargeEvent {
  event: "charge.success";
  data: {
    reference: string;
    status: "success";
    amount: number; // kobo
    currency: string;
    customer: { email: string };
    metadata: {
      userId: string;
      packId: string;
      coinsGranted?: number;
      starsGranted?: number;
      itemType: "coin_pack" | "star_pack" | "subscription";
      packName: string;
    };
    paid_at: string;
  };
}

interface PaystackTransferEvent {
  event: "transfer.success" | "transfer.failed" | "transfer.reversed";
  data: {
    reference: string;
    status: string;
    amount: number;
    transfer_code: string;
  };
}

interface PaystackSubscriptionEvent {
  event: "subscription.create" | "subscription.not_renew" | "subscription.disable";
  data: {
    subscription_code: string;
    status: "active" | "non-renewing" | "cancelled" | "attention" | "completed";
    plan: { plan_code: string; name: string };
    customer: { email: string; customer_code: string; metadata?: { userId?: string } };
    next_payment_date?: string;
    cancelledAt?: string;
  };
}

type PaystackEvent = PaystackChargeEvent | PaystackTransferEvent | PaystackSubscriptionEvent;

// ---------------------------------------------------------------------------
// Helper: process a successful charge
// ---------------------------------------------------------------------------

async function processChargeSuccess(
  data: PaystackChargeEvent["data"]
): Promise<void> {
  const { reference, metadata, amount } = data;

  await db.transaction(async (tx) => {
    // Idempotency guard — check if this reference was already processed
    const { rows: existing } = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments
       WHERE provider_reference = $1
       FOR UPDATE`,
      [reference]
    );

    if (!existing[0]) {
      // Payment record created at initiation — if it's missing, log and bail
      console.error(`[webhook/paystack] No payment record for reference: ${reference}`);
      return;
    }

    if (existing[0].status === "completed") {
      // Already processed — safe to return 200 without re-crediting
      console.info(`[webhook/paystack] Duplicate event for reference: ${reference}`);
      return;
    }

    // Mark payment as completed
    await tx.query(
      `UPDATE payments
       SET status = 'completed', completed_at = NOW(), amount_received_kobo = $1
       WHERE provider_reference = $2`,
      [amount, reference]
    );

    const paymentId = existing[0].id;
    const { userId, coinsGranted, starsGranted, itemType } = metadata;

    // Subscription charges: plan activation is handled by subscription.create event;
    // skip coin/star crediting here to avoid double-crediting or NaN errors.
    if (itemType === "subscription") {
      return;
    }

    // Credit coins or stars based on pack type
    if (itemType === "star_pack") {
      await creditStars(
        userId,
        starsGranted ?? 0,
        "purchase",
        paymentId,
        `Purchased ${metadata.packName}`,
        tx
      );
    } else {
      await creditCoins(
        userId,
        coinsGranted,
        "purchase",
        paymentId,
        `Purchased ${metadata.packName}`,
        { packId: metadata.packId, amountKobo: amount },
        tx
      );

      // Award referral commissions (Tier 1 + Tier 2) for coin purchases
      await awardReferralCommissions(tx, userId, coinsGranted).catch((err) =>
        console.error("[webhook/paystack] Referral commission error:", err)
      );
    }

    // Seed 5% of gross revenue into Creator Fund (PRD §14)
    const creatorFundContributionKobo = Math.floor(amount * 0.05);
    if (creatorFundContributionKobo > 0) {
      await tx.query(
        `INSERT INTO x_manifest (key, value, updated_at)
         VALUES ('creator_fund_balance_kobo', $1::TEXT, NOW())
         ON CONFLICT (key) DO UPDATE
           SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT,
               updated_at = NOW()`,
        [creatorFundContributionKobo]
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Helper: process transfer status updates (payout webhook)
// ---------------------------------------------------------------------------

async function processTransferEvent(
  event: PaystackTransferEvent
): Promise<void> {
  const { reference, status } = event.data;

  const dbStatus =
    event.event === "transfer.success"
      ? "completed"
      : event.event === "transfer.failed"
      ? "failed"
      : "reversed";

  await db.query(
    `UPDATE creator_payouts
     SET status = $1, provider_status = $2, updated_at = NOW()
     WHERE provider_reference = $3`,
    [dbStatus, status, reference]
  );
}

// ---------------------------------------------------------------------------
// Helper: process subscription lifecycle events
// ---------------------------------------------------------------------------

async function processSubscriptionEvent(
  event: PaystackSubscriptionEvent
): Promise<void> {
  const { subscription_code, status, customer, next_payment_date } = event.data;
  const userId = customer.metadata?.userId ?? null;

  if (!userId) {
    // Try to look up user by email
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [customer.email]
    );
    if (!rows[0]) {
      console.warn(`[webhook/paystack] Subscription event: no user for email ${customer.email}`);
      return;
    }
  }

  const resolvedUserId = userId ?? (await db.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
    [customer.email]
  )).rows[0]?.id;

  if (!resolvedUserId) return;

  // Map Paystack status to internal plan status
  const isActive = status === "active";
  const isCancelled = status === "cancelled" || status === "non-renewing" || status === "completed";

  if (event.event === "subscription.create") {
    // New subscription — update or insert user subscription record
    await db.query(
      `INSERT INTO user_subscriptions
         (user_id, provider, provider_subscription_id, status, next_renewal_at, updated_at)
       VALUES ($1, 'paystack', $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET provider_subscription_id = $2, status = $3, next_renewal_at = $4, updated_at = NOW()`,
      [resolvedUserId, subscription_code, isActive ? "active" : status, next_payment_date ?? null]
    ).catch(() => {});

    // Derive plan tier from Paystack plan name (max → max, plus → plus, else → pro)
    const planNameLower = (event.data.plan?.name ?? "").toLowerCase();
    const derivedPlan = planNameLower.includes("max")
      ? "max"
      : planNameLower.includes("plus")
      ? "plus"
      : "pro";
    await db.query(
      `UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2`,
      [derivedPlan, resolvedUserId]
    ).catch(() => {});

  } else if (isCancelled || event.event === "subscription.disable") {
    // Subscription cancelled / not renewing
    await db.query(
      `UPDATE user_subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE user_id = $1`,
      [resolvedUserId]
    ).catch(() => {});

    // Downgrade plan to free
    await db.query(
      `UPDATE users SET plan = 'free', updated_at = NOW() WHERE id = $1`,
      [resolvedUserId]
    ).catch(() => {});
  }

  // Write notification to user
  await db.query(
    `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
     VALUES ($1, $2, $3, false, NOW())`,
    [
      resolvedUserId,
      event.event === "subscription.create" ? "subscription_activated" : "subscription_cancelled",
      JSON.stringify({ subscriptionCode: subscription_code, status, nextPaymentDate: next_payment_date }),
    ]
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/economy/webhooks/paystack
 *
 * Paystack will retry on non-200 responses. We always return 200 after
 * signature validation — processing errors are logged, not retried.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Read raw body bytes for signature validation
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("x-paystack-signature") ?? "";

  // 2. Validate HMAC-SHA512 signature — reject silently to avoid oracle attacks
  const isValid = verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    console.warn("[webhook/paystack] Invalid signature rejected");
    return NextResponse.json({ received: false }, { status: 401 });
  }

  // 3. Parse event
  let event: PaystackEvent;
  try {
    event = JSON.parse(rawBody.toString("utf-8")) as PaystackEvent;
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  // 4. Route to handler (failures are caught so we can still return 200)
  try {
    switch (event.event) {
      case "charge.success":
        await processChargeSuccess((event as PaystackChargeEvent).data);
        break;

      case "transfer.success":
      case "transfer.failed":
      case "transfer.reversed":
        await processTransferEvent(event as PaystackTransferEvent);
        break;

      case "subscription.create":
      case "subscription.not_renew":
      case "subscription.disable":
        await processSubscriptionEvent(event as PaystackSubscriptionEvent);
        break;

      default:
        // Ignore unknown events
        console.info(`[webhook/paystack] Ignoring unhandled event: ${(event as { event: string }).event}`);
    }
  } catch (err) {
    // Log the error but return 200 so Paystack doesn't retry indefinitely.
    // A monitoring alert should fire on these log lines.
    console.error("[webhook/paystack] Processing error:", err);
  }

  return NextResponse.json({ received: true });
}
