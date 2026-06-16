export const dynamic = 'force-dynamic';

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
import { redis } from "@/lib/redis";
import {
  handleDodoWebhookPayload,
  type DodoPaymentSucceededEvent,
  type DodoPayoutEvent,
  type DodoEvent,
} from "@/lib/payments/dodoWebhookHandler";

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

  // 3b. Replay protection — deduplicate by event ID using Redis (STRUC-04)
  const eventId = (event as DodoPaymentSucceededEvent).data?.id
    ?? (event as DodoPayoutEvent).data?.reference
    ?? null;
  const replayKey = eventId ? `webhook:dodo:${event.event}:${eventId}` : null;
  if (replayKey) {
    // If Redis SET throws, return 500 so DodoPayments retries the webhook rather
    // than silently treating a Redis failure as a duplicate event.
    const alreadySeen = await redis.set(replayKey, "1", "EX", 86400, "NX");
    if (alreadySeen === null) {
      // null = NX condition not met → key already existed → duplicate event
      console.info(`[webhook/dodopayments] Duplicate event ignored: ${replayKey}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  // 4. Route to handler
  try {
    await handleDodoWebhookPayload(event.event, event);
  } catch (err) {
    console.error("[webhook/dodopayments] Processing error:", err);
  }

  return NextResponse.json({ received: true });
}
