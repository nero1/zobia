export const dynamic = 'force-dynamic';

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
import { redis } from "@/lib/redis";
import {
  handlePaystackWebhookPayload,
  type PaystackChargeEvent,
  type PaystackTransferEvent,
  type PaystackSubscriptionEvent,
  type PaystackEvent,
} from "@/lib/payments/paystackWebhookHandler";

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

  // 3b. Replay protection — deduplicate by event reference using Redis (STRUC-04)
  // Extract a stable event identifier (charge reference or subscription code)
  const eventRef = (event as PaystackChargeEvent).data?.reference
    ?? (event as PaystackTransferEvent).data?.reference
    ?? (event as PaystackSubscriptionEvent).data?.subscription_code
    ?? null;
  const eventTs = (event as PaystackChargeEvent).data?.paid_at ?? (event as { data?: { created_at?: string } }).data?.created_at ?? Date.now().toString();
  const replayKey = `webhook:paystack:${event.event}:${eventRef ?? `ts-${eventTs}`}`;
  // If Redis SET throws, return 500 so Paystack retries the webhook rather than
  // silently treating a Redis failure as a duplicate event.
  const alreadySeen = await redis.set(replayKey, "1", "EX", 86400, "NX");
  if (alreadySeen === null) {
    // null = NX condition not met → key already existed → duplicate event
    console.info(`[webhook/paystack] Duplicate event ignored: ${replayKey}`);
    return NextResponse.json({ received: true, duplicate: true });
  }

  // 4. Route to handler (failures are caught so we can still return 200)
  try {
    await handlePaystackWebhookPayload(event.event, event);
  } catch (err) {
    const errCode = (err as NodeJS.ErrnoException).code;
    const isTransient = errCode === "ECONNREFUSED" || errCode === "ETIMEDOUT" || errCode === "ECONNRESET";
    if (isTransient) {
      console.error("[webhook/paystack] Transient error (Paystack will retry):", err);
      return NextResponse.json({ received: false, error: "Processing failed" }, { status: 500 });
    }
    // Non-recoverable error — log for ops review but return 200 to stop Paystack retry loops
    console.error("[webhook/paystack] Non-recoverable processing error:", err);
    db.query(
      `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
       VALUES ('webhook_processing_error', 'critical', $1, $2::jsonb, NOW())`,
      [(err as Error).message, JSON.stringify({ webhook: "paystack", error: (err as Error).message })]
    ).catch(() => {});
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
