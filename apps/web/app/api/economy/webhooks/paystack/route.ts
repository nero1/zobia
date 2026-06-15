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
      itemType: "coin_pack" | "star_pack" | "subscription" | "room_subscription" | "room_entry";
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
    customer: { email: string; customer_code: string; metadata?: { userId?: string; starsGranted?: number } };
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

    // VIP room subscription — activate room access
    if (itemType === "room_subscription") {
      const { roomId, grossKobo: subGrossKobo, subscriptionDays = 30 } = metadata as unknown as {
        roomId: string;
        grossKobo: number;
        subscriptionDays?: number;
      };
      const expiresAt = new Date(Date.now() + subscriptionDays * 24 * 60 * 60 * 1000).toISOString();

      await tx.query(
        `INSERT INTO room_subscriptions
           (room_id, user_id, status, amount_kobo, started_at, expires_at)
         VALUES ($1, $2, 'active', $3, NOW(), $4)
         ON CONFLICT (room_id, user_id) DO UPDATE
           SET status = 'active', amount_kobo = $3, started_at = NOW(), expires_at = $4`,
        [roomId, userId, subGrossKobo ?? amount, expiresAt]
      );

      await tx.query(
        `INSERT INTO room_members (room_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', NOW())
         ON CONFLICT (room_id, user_id) DO NOTHING`,
        [roomId, userId]
      );

      // Credit creator earnings (80% default)
      const roomRow = await tx.query<{ creator_id: string; creator_tier: string | null }>(
        `SELECT r.creator_id, u.creator_tier
         FROM rooms r JOIN users u ON u.id = r.creator_id WHERE r.id = $1`,
        [roomId]
      );
      const creator = roomRow.rows[0];
      if (creator) {
        const sharePercent = creator.creator_tier === "icon" ? 85 : 80;
        const netKobo = Math.floor(((subGrossKobo ?? amount) * sharePercent) / 100);
        const platformFeeKobo = (subGrossKobo ?? amount) - netKobo;
        await tx.query(
          `INSERT INTO creator_earnings
             (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
           VALUES ($1, 'subscription', $2, $3, $4, $5)`,
          [creator.creator_id, subGrossKobo ?? amount, platformFeeKobo, netKobo, paymentId]
        );
        await tx.query(
          `UPDATE users
           SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1, updated_at = NOW()
           WHERE id = $2`,
          [netKobo, creator.creator_id]
        );
      }
      return;
    }

    // Drop-room entry payment — payment is already marked completed above.
    // The join route validates payment.status='completed'; no coin credit needed.
    if (itemType === "room_entry") {
      return;
    }

    // Re-derive grant amounts server-side from store_items to prevent metadata tampering
    let serverCoinsGranted = coinsGranted ?? 0;
    let serverStarsGranted = starsGranted ?? 0;
    if (metadata.packId) {
      const { rows: packRows } = await tx.query<{ coins_granted: number | null; stars_granted: number | null; price_kobo: number | null }>(
        `SELECT coins_granted, stars_granted, price_kobo FROM store_items WHERE id = $1 LIMIT 1`,
        [metadata.packId]
      );
      if (packRows[0]) {
        if (packRows[0].coins_granted != null) serverCoinsGranted = packRows[0].coins_granted;
        if (packRows[0].stars_granted != null) serverStarsGranted = packRows[0].stars_granted;

        // Bug #18: Reject underpayments — never credit if paid amount < pack price
        if (packRows[0].price_kobo != null && amount < packRows[0].price_kobo) {
          console.warn(
            `[webhook/paystack] Underpayment detected: paid ${amount} kobo for pack ${metadata.packId} ` +
            `priced at ${packRows[0].price_kobo} kobo. Flagging for manual review.`
          );
          await tx.query(
            `UPDATE payments SET status = 'underpaid', updated_at = NOW() WHERE provider_reference = $1`,
            [reference]
          ).catch(() => {});
          await tx.query(
            `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
             VALUES ('underpayment', 'critical', $1, $2::jsonb, NOW())`,
            [
              `Underpayment for reference ${reference}: paid ${amount}, expected ${packRows[0].price_kobo}`,
              JSON.stringify({ reference, amount, priceKobo: packRows[0].price_kobo, userId, packId: metadata.packId }),
            ]
          ).catch(() => {});
          return;
        }
      }
    }

    // Credit coins or stars based on pack type
    if (itemType === "star_pack") {
      await creditStars(
        userId,
        serverStarsGranted,
        "purchase",
        paymentId,
        `Purchased ${metadata.packName}`,
        tx
      );
    } else if (serverCoinsGranted > 0) {
      await creditCoins(
        userId,
        serverCoinsGranted,
        "purchase",
        paymentId,
        `Purchased ${metadata.packName}`,
        { packId: metadata.packId, amountKobo: amount },
        tx
      );

      // Award referral commissions using server-derived amount, not client metadata (#17)
      await awardReferralCommissions(tx, userId, serverCoinsGranted, paymentId).catch((err) =>
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
  const { reference, status, transfer_code } = event.data;

  // Look up payout by provider_reference (transfer_code stored at initiation)
  const { rows } = await db.query<{
    id: string;
    creator_id: string;
    gross_kobo: number;
    retry_count: number;
  }>(
    `SELECT id, creator_id, gross_kobo, retry_count
     FROM creator_payouts
     WHERE provider_reference = $1
     LIMIT 1`,
    [transfer_code ?? reference]
  );

  if (!rows[0]) {
    console.warn(`[webhook/paystack] No payout found for transfer reference: ${transfer_code ?? reference}`);
    return;
  }

  const payout = rows[0];

  if (event.event === "transfer.success") {
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE creator_payouts
         SET status = 'completed', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [payout.id]
      );
    });

    // Notify creator of successful payout
    await db.query(
      `INSERT INTO notifications
         (user_id, type, title, body, metadata, created_at)
       VALUES ($1, 'payout_completed', 'Payout Successful',
         'Your payout has been processed and is on its way to your bank account.',
         $2::jsonb, NOW())`,
      [payout.creator_id, JSON.stringify({ payoutId: payout.id, reference })]
    ).catch(() => {});

  } else if (event.event === "transfer.failed") {
    // Import retry logic from payouts lib
    const { moveToDeadLetterQueue, notifyPayoutFailure } = await import("@/lib/payments/payouts");
    const { loadManifest } = await import("@/lib/manifest");

    const manifest = await loadManifest();
    const maxRetries = manifest.payouts.maxRetries;

    const newRetryCount = payout.retry_count + 1;

    if (newRetryCount >= maxRetries) {
      // moveToDeadLetterQueue already uses earnings_restored guard internally
      await moveToDeadLetterQueue(
        payout.id,
        payout.creator_id,
        newRetryCount,
        `Paystack transfer failed after ${maxRetries} attempts. Status: ${status}`
      );
      await notifyPayoutFailure(
        payout.id,
        payout.creator_id,
        `Your payout could not be processed after multiple attempts. Please check your bank account details.`
      );
    } else {
      // Exponential backoff: 5min, 15min, 45min
      const backoffMinutes = [5, 15, 45][Math.min(newRetryCount - 1, 2)];
      await db.query(
        `UPDATE creator_payouts
         SET status = 'failed',
             retry_count = $1,
             last_retry_at = NOW(),
             next_retry_at = NOW() + ($2 || ' minutes')::INTERVAL,
             updated_at = NOW()
         WHERE id = $3`,
        [newRetryCount, backoffMinutes, payout.id]
      );
    }

  } else if (event.event === "transfer.reversed") {
    // Restore earnings to creator — guard with FOR UPDATE + earnings_restored flag
    // to prevent duplicate webhook deliveries from double-crediting (#8)
    await db.transaction(async (tx) => {
      const { rows: cur } = await tx.query<{ status: string; earnings_restored: boolean }>(
        `SELECT status, earnings_restored FROM creator_payouts WHERE id = $1 FOR UPDATE`,
        [payout.id]
      );
      if (!cur[0] || cur[0].status === "reversed") return; // already handled

      await tx.query(
        `UPDATE creator_payouts
         SET status = 'reversed', updated_at = NOW()
         WHERE id = $1`,
        [payout.id]
      );

      if (!cur[0].earnings_restored) {
        await tx.query(
          `UPDATE creator_payouts SET earnings_restored = true WHERE id = $1`,
          [payout.id]
        );
        await tx.query(
          `UPDATE users
           SET available_earnings_kobo = available_earnings_kobo + $1, updated_at = NOW()
           WHERE id = $2`,
          [payout.gross_kobo, payout.creator_id]
        );
      }
    });

    // Notify creator of reversal
    await db.query(
      `INSERT INTO notifications
         (user_id, type, title, body, metadata, created_at)
       VALUES ($1, 'payout_reversed', 'Payout Reversed',
         'Your payout was reversed by the payment network. Your earnings have been restored to your balance. Please verify your bank account details.',
         $2::jsonb, NOW())`,
      [payout.creator_id, JSON.stringify({ payoutId: payout.id })]
    ).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Helper: process subscription lifecycle events
// ---------------------------------------------------------------------------

async function processSubscriptionEvent(
  event: PaystackSubscriptionEvent
): Promise<void> {
  const { subscription_code, status, customer, next_payment_date } = event.data;
  const userId = customer.metadata?.userId ?? null;

  // Single email lookup — cache result to avoid duplicate DB round-trip (BUG-13)
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [customer.email]
    );
    resolvedUserId = rows[0]?.id ?? null;
    if (!resolvedUserId) {
      console.warn(`[webhook/paystack] Subscription event: no user for email ${customer.email}`);
      return;
    }
  }

  if (!resolvedUserId) return;

  // Map Paystack status to internal plan status.
  // non-renewing = paid-up but will not auto-renew; user keeps access until period end.
  // completed / cancelled = hard cancellation; downgrade immediately.
  const isActive = status === "active";
  const isNonRenewing = status === "non-renewing";
  const isCancelled = status === "cancelled" || status === "completed";

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

    // Derive plan tier from Paystack plan name.
    // If the plan name is unrecognised, log a system alert and skip plan activation
    // to prevent silently granting the wrong tier.
    const planNameLower = (event.data.plan?.name ?? "").toLowerCase();
    const derivedPlan: string | null = planNameLower.includes("max")
      ? "max"
      : planNameLower.includes("plus")
      ? "plus"
      : planNameLower.includes("pro")
      ? "pro"
      : null;

    if (!derivedPlan) {
      console.error(
        `[webhook/paystack] Unrecognised plan name '${event.data.plan?.name}' for subscription ${subscription_code}. No plan activated.`
      );
      await db.query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('unknown_plan_code', 'high', $1, $2::jsonb, NOW())`,
        [
          `Unknown Paystack plan name: ${event.data.plan?.name}`,
          JSON.stringify({ subscriptionCode: subscription_code, planName: event.data.plan?.name, userId: resolvedUserId }),
        ]
      ).catch(() => {});
      return;
    }

    await db.transaction(async (tx) => {
      // Update plan
      await tx.query(
        `UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2`,
        [derivedPlan, resolvedUserId]
      );

      // Award monthly subscription bonus coins (PRD §3).
      // BUG-21: Key on `plan:{userId}:{YYYY-MM}` rather than subscription_code so
      // that the CRON's monthly_plan_bonus (which uses the same pattern) hits the same
      // dedup key and only one credit is issued when both fire on the 1st of the month.
      const MONTHLY_PLAN_BONUS: Record<string, number> = { plus: 50, pro: 200, max: 500 };
      const bonusCoins = MONTHLY_PLAN_BONUS[derivedPlan];
      if (bonusCoins && bonusCoins > 0) {
        const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
        await creditCoins(
          resolvedUserId,
          bonusCoins,
          "subscription_bonus",
          `plan:${resolvedUserId}:${monthKey}`,
          `${derivedPlan} plan subscription — monthly coin bonus`,
          { plan: derivedPlan },
          tx
        );
      }

      // Award subscription stars if the plan includes a star grant (BUG-56).
      const subscriptionStars = customer.metadata?.starsGranted ?? 0;
      if (subscriptionStars > 0) {
        await creditStars(
          resolvedUserId,
          subscriptionStars,
          "purchase",
          `plan:stars:${resolvedUserId}:${new Date().toISOString().slice(0, 7)}`,
          `${derivedPlan} plan subscription — star bonus`,
          tx
        );
      }
    }).catch((err: unknown) => {
      // BUG-21: swallow unique constraint violations (23505) — they mean the CRON
      // already awarded the bonus for this month, which is the correct outcome.
      const pgCode = (err as { code?: string })?.code;
      if (pgCode === '23505') {
        console.info('[webhook/paystack] subscription_bonus already awarded this month (23505) — skipping');
      } else {
        console.error("[webhook/paystack] Transaction error for subscription bonus:", err);
      }
    });

  } else if (isNonRenewing) {
    // Subscription will not renew but is still active until period end.
    // Mark as 'cancelling' and keep plan; the daily cron downgrades when period lapses (#16).
    await db.query(
      `UPDATE user_subscriptions
       SET status = 'cancelling', updated_at = NOW()
       WHERE user_id = $1`,
      [resolvedUserId]
    ).catch(() => {});

  } else if (isCancelled || event.event === "subscription.disable") {
    // Hard cancellation or provider-disabled — downgrade immediately
    await db.query(
      `UPDATE user_subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE user_id = $1`,
      [resolvedUserId]
    ).catch(() => {});

    await db.query(
      `UPDATE users SET plan = 'free', updated_at = NOW() WHERE id = $1`,
      [resolvedUserId]
    ).catch(() => {});
  }

  // Write notification to user using canonical schema (title/body/metadata columns)
  let notifType = "subscription_cancelled";
  let notifTitle = "Subscription Cancelled";
  let notifBody = "Your subscription has been cancelled.";
  if (event.event === "subscription.create") {
    notifType = "subscription_activated";
    notifTitle = "Subscription Activated";
    notifBody = "Your subscription is now active. Enjoy your benefits!";
  } else if (isNonRenewing) {
    notifType = "subscription_non_renewing";
    notifTitle = "Subscription Ending";
    notifBody = "Your subscription will not renew at the end of the current period.";
  }

  await db.query(
    `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, false, NOW())`,
    [
      resolvedUserId,
      notifType,
      notifTitle,
      notifBody,
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

  // 3b. Replay protection — deduplicate by event reference using Redis (STRUC-04)
  // Extract a stable event identifier (charge reference or subscription code)
  const eventRef = (event as PaystackChargeEvent).data?.reference
    ?? (event as PaystackTransferEvent).data?.reference
    ?? (event as PaystackSubscriptionEvent).data?.subscription_code
    ?? null;
  const replayKey = eventRef ? `webhook:paystack:${event.event}:${eventRef}` : null;
  if (replayKey) {
    // If Redis SET throws, return 500 so Paystack retries the webhook rather than
    // silently treating a Redis failure as a duplicate event.
    const alreadySeen = await redis.set(replayKey, "1", "EX", 86400, "NX");
    if (alreadySeen === null) {
      // null = NX condition not met → key already existed → duplicate event
      console.info(`[webhook/paystack] Duplicate event ignored: ${replayKey}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
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
