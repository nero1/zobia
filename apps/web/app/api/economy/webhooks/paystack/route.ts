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
      coinsGranted: number;
      itemType: "coin_pack" | "star_pack";
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

type PaystackEvent = PaystackChargeEvent | PaystackTransferEvent;

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
    const { userId, coinsGranted, itemType } = metadata;

    // Credit coins or stars based on pack type
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
        { packId: metadata.packId, amountKobo: amount },
        tx
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
