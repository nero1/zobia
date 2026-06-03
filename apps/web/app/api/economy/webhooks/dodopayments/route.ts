/**
 * POST /api/economy/webhooks/dodopayments
 *
 * DodoPayments event webhook handler.
 *
 * Security model:
 *   - Validates HMAC-SHA256 signature before ANY processing
 *   - Idempotent: skips already-processed payment references
 *   - Returns 200 immediately after validation
 *
 * Supported events:
 *   - payment.succeeded → credits coins / stars to the purchasing user
 *   - payout.completed  → marks creator payout as completed
 *   - payout.failed     → marks creator payout as failed
 *
 * @module app/api/economy/webhooks/dodopayments
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/dodopayments";
import { db } from "@/lib/db";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { awardReferralCommissions } from "@/lib/referrals/commissions";

// ---------------------------------------------------------------------------
// DodoPayments webhook event types
// ---------------------------------------------------------------------------

interface DodoPaymentSucceededEvent {
  event: "payment.succeeded";
  data: {
    id: string;
    status: "succeeded";
    amount: number;
    currency: string;
    metadata: {
      userId: string;
      packId: string;
      coinsGranted: number;
      itemType: "coin_pack" | "star_pack";
      packName: string;
      idempotencyKey: string;
    };
    created_at: string;
  };
}

interface DodoPayoutEvent {
  event: "payout.completed" | "payout.failed";
  data: {
    id: string;
    reference: string;
    status: string;
    amount: number;
    currency: string;
  };
}

type DodoEvent = DodoPaymentSucceededEvent | DodoPayoutEvent;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function processPaymentSucceeded(
  data: DodoPaymentSucceededEvent["data"]
): Promise<void> {
  const { id: providerReference, metadata, amount } = data;

  await db.transaction(async (tx) => {
    // Idempotency guard
    const { rows: existing } = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments
       WHERE provider_reference = $1
       FOR UPDATE`,
      [providerReference]
    );

    if (!existing[0]) {
      console.error(
        `[webhook/dodopayments] No payment record for reference: ${providerReference}`
      );
      return;
    }

    if (existing[0].status === "completed") {
      console.info(
        `[webhook/dodopayments] Duplicate event for reference: ${providerReference}`
      );
      return;
    }

    await tx.query(
      `UPDATE payments
       SET status = 'completed', completed_at = NOW(), amount_received_kobo = $1
       WHERE provider_reference = $2`,
      [amount, providerReference]
    );

    const paymentId = existing[0].id;
    const { userId, coinsGranted, itemType } = metadata;

    if (itemType === "star_pack") {
      await creditStars(
        userId,
        coinsGranted,
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
        { packId: metadata.packId, amountSmallestUnit: amount, currency: data.currency },
        tx
      );

      // Award referral commissions for coin purchases
      await awardReferralCommissions(tx, userId, coinsGranted).catch((err) =>
        console.error("[webhook/dodo] Referral commission error:", err)
      );
    }
  });
}

async function processPayoutEvent(event: DodoPayoutEvent): Promise<void> {
  const { reference, status } = event.data;
  const dbStatus = event.event === "payout.completed" ? "completed" : "failed";

  await db.query(
    `UPDATE creator_payouts
     SET status = $1, provider_status = $2, updated_at = NOW()
     WHERE provider_reference = $3`,
    [dbStatus, status, reference]
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/economy/webhooks/dodopayments
 *
 * DodoPayments retries on non-200. We return 200 after signature validation;
 * processing errors are logged separately.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Read raw body
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("x-dodo-signature") ?? "";

  // 2. Validate HMAC-SHA256 signature
  const isValid = verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    console.warn("[webhook/dodopayments] Invalid signature rejected");
    return NextResponse.json({ received: false }, { status: 401 });
  }

  // 3. Parse event
  let event: DodoEvent;
  try {
    event = JSON.parse(rawBody.toString("utf-8")) as DodoEvent;
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  // 4. Route to handler
  try {
    switch (event.event) {
      case "payment.succeeded":
        await processPaymentSucceeded((event as DodoPaymentSucceededEvent).data);
        break;

      case "payout.completed":
      case "payout.failed":
        await processPayoutEvent(event as DodoPayoutEvent);
        break;

      default:
        console.info(
          `[webhook/dodopayments] Ignoring unhandled event: ${(event as { event: string }).event}`
        );
    }
  } catch (err) {
    console.error("[webhook/dodopayments] Processing error:", err);
  }

  return NextResponse.json({ received: true });
}
