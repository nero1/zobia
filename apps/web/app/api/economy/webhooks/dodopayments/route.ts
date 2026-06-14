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
      packId?: string;
      coinsGranted?: number;
      starsGranted?: number;
      itemType: "coin_pack" | "star_pack" | "subscription" | "room_subscription";
      packName?: string;
      idempotencyKey: string;
      planId?: string;
      planName?: string;
      interval?: string;
      type?: string;
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
    const { userId, itemType } = metadata;

    // Resolve server-authoritative grant amounts from store_items to prevent metadata tampering (BUG-02)
    const itemSlug = (metadata as { itemSlug?: string }).itemSlug;
    let serverCoinsGranted = metadata.coinsGranted ?? 0;
    let serverStarsGranted = metadata.starsGranted ?? 0;
    let grantResolvedFromDb = false;
    if (itemSlug && (itemType === "coin_pack" || itemType === "star_pack")) {
      const { rows: itemRows } = await tx.query<{
        coins_granted: number | null;
        stars_granted: number | null;
      }>(
        `SELECT coins_granted, stars_granted FROM store_items WHERE slug = $1 AND is_active = true LIMIT 1`,
        [itemSlug]
      );
      if (!itemRows[0]) {
        console.error(`[webhook/dodopayments] Unknown store item slug: ${itemSlug}`);
        return;
      }
      if (itemRows[0].coins_granted != null) serverCoinsGranted = itemRows[0].coins_granted;
      if (itemRows[0].stars_granted != null) serverStarsGranted = itemRows[0].stars_granted;
      grantResolvedFromDb = true;
    }

    // Safety guard: if this is a coin_pack but we could not resolve an amount
    // from the database (no itemSlug), reject silently rather than crediting 0.
    if (itemType === "coin_pack" && !grantResolvedFromDb && serverCoinsGranted === 0) {
      console.error(
        `[webhook/dodopayments] coin_pack payment ${paymentId} has no itemSlug and coinsGranted=0 — queued for manual review`,
        { paymentId, metadata }
      );
      await tx.query(
        `INSERT INTO failed_webhooks (provider, event_type, payload, reason, created_at)
         VALUES ('dodopayments', 'payment.succeeded', $1::jsonb, $2, NOW())
         ON CONFLICT DO NOTHING`,
        [JSON.stringify({ paymentId, metadata }), 'coin_pack_zero_grant']
      ).catch(() => {});
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

      // Credit creator earnings
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

    // Handle subscription activation (PRD §3)
    if (itemType === "subscription") {
      const planName = metadata.planName ?? "pro";

      // Write to user_subscriptions (canonical table) — BUG-04
      await tx.query(
        `INSERT INTO user_subscriptions
           (user_id, plan, status, provider, provider_subscription_id, starts_at, ends_at, created_at, updated_at)
         VALUES ($1, $2, 'active', 'dodopayments', $3, NOW(), NOW() + (INTERVAL '1 month'), NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET plan = $2, status = 'active', provider = 'dodopayments',
               provider_subscription_id = $3, updated_at = NOW()`,
        [userId, planName, providerReference]
      );

      // Update users.plan
      await tx.query(
        `UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2`,
        [planName, userId]
      );

      // Award monthly subscription bonus coins (PRD §3)
      const MONTHLY_PLAN_BONUS: Record<string, number> = { plus: 50, pro: 200, max: 500 };
      const bonusCoins = MONTHLY_PLAN_BONUS[planName];
      if (bonusCoins && bonusCoins > 0) {
        await creditCoins(
          userId,
          bonusCoins,
          "subscription_bonus",
          providerReference,
          `${planName} plan subscription — monthly coin bonus`,
          { plan: planName },
          tx
        );
      }
    } else if (itemType === "star_pack") {
      await creditStars(
        userId,
        serverStarsGranted,
        "purchase",
        paymentId,
        `Purchased ${metadata.packName}`,
        tx
      );
    } else {
      // Coin pack — use server-authoritative amount (BUG-02)
      await creditCoins(
        userId,
        serverCoinsGranted,
        "purchase",
        paymentId,
        `Purchased ${metadata.packName}`,
        { packId: metadata.packId, amountSmallestUnit: amount, currency: data.currency },
        tx
      );

      // Award referral commissions; pass paymentId as idempotency key (BUG-03)
      await awardReferralCommissions(tx, userId, serverCoinsGranted, paymentId).catch((err) =>
        console.error("[webhook/dodo] Referral commission error:", err)
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
