/**
 * lib/payments/paystackWebhookHandler.ts
 *
 * Shared Paystack webhook payload processing logic used by both:
 *   - app/api/economy/webhooks/paystack/route.ts (live webhook ingestion)
 *   - app/api/cron/daily/route.ts (failed-webhook retry queue)
 */

import { db } from "@/lib/db";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { awardReferralCommissions } from "@/lib/referrals/commissions";
import { getCreatorFeeRate, moveToDeadLetterQueue, notifyPayoutFailure } from "@/lib/payments/payouts";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Paystack webhook event types (subset)
// ---------------------------------------------------------------------------

export interface PaystackChargeEvent {
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
      itemType: "coin_pack" | "star_pack" | "subscription" | "room_subscription" | "room_entry" | "business_upgrade";
      packName: string;
      businessAccountId?: string;
      newTier?: string;
    };
    paid_at: string;
  };
}

export interface PaystackTransferEvent {
  event: "transfer.success" | "transfer.failed" | "transfer.reversed";
  data: {
    reference: string;
    status: string;
    amount: number;
    transfer_code: string;
  };
}

export interface PaystackSubscriptionEvent {
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

export type PaystackEvent = PaystackChargeEvent | PaystackTransferEvent | PaystackSubscriptionEvent;

// ---------------------------------------------------------------------------
// Helper: process a successful charge
// ---------------------------------------------------------------------------

export async function processChargeSuccess(
  data: PaystackChargeEvent["data"]
): Promise<void> {
  const { reference, metadata, amount } = data;

  // Capture referral commission params from within the transaction so we can
  // fire awardReferralCommissions after the transaction commits (B12).
  let referralPayload: { userId: string; coins: number; paymentId: string; amountKobo: number } | null = null;

  await db.transaction(async (tx) => {
    // Idempotency guard — check if this reference was already processed
    const { rows: existing } = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments
       WHERE provider_reference = $1
       FOR UPDATE`,
      [reference]
    );

    if (!existing[0]) {
      console.error(`[webhook/paystack] No payment record for reference: ${reference}`);
      return;
    }

    if (existing[0].status === "completed") {
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
      const rawMeta = metadata as Record<string, unknown>;
      // Validate required fields before any DB write — missing fields must NOT return 200
      // (Paystack would consider the event delivered and stop retrying)
      if (
        !rawMeta.roomId ||
        typeof rawMeta.roomId !== "string" ||
        rawMeta.grossKobo === undefined ||
        rawMeta.grossKobo === null ||
        (typeof rawMeta.grossKobo !== "number" && typeof rawMeta.grossKobo !== "string")
      ) {
        console.error(
          `[webhook/paystack] room_subscription metadata missing required fields`,
          { reference, rawMeta }
        );
        throw new Error(`room_subscription webhook missing required metadata fields (reference: ${reference})`);
      }
      let roomId: string | null = rawMeta.roomId as string;
      const subGrossKobo = Number(rawMeta.grossKobo);
      const subscriptionDays = typeof rawMeta.subscriptionDays === "number"
        ? rawMeta.subscriptionDays
        : 30;
      const expiresAt = new Date(Date.now() + subscriptionDays * 24 * 60 * 60 * 1000).toISOString();

      // Verify the room exists before inserting a subscription
      if (roomId) {
        const roomCheck = await tx.query(
          `SELECT id FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
          [roomId]
        );
        if (!roomCheck.rows[0]) {
          console.warn(`[paystackWebhook] Room ${roomId} not found, skipping room subscription`);
          roomId = null;
        }
      }

      if (!roomId) {
        return;
      }

      await tx.query(
        `INSERT INTO room_subscriptions
           (room_id, user_id, status, amount_kobo, started_at, expires_at)
         VALUES ($1, $2, 'active', $3, NOW(), $4)
         ON CONFLICT (room_id, user_id) DO UPDATE
           SET status = 'active', amount_kobo = $3, started_at = NOW(), expires_at = $4`,
        [roomId, userId, subGrossKobo, expiresAt]
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
        const feeRate = getCreatorFeeRate(creator.creator_tier);
        const sharePercent = Math.round((1 - feeRate) * 100);
        const netKobo = Math.floor((subGrossKobo * sharePercent) / 100);
        const platformFeeKobo = subGrossKobo - netKobo;
        await tx.query(
          `INSERT INTO creator_earnings
             (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
           VALUES ($1, 'subscription', $2, $3, $4, $5)
           ON CONFLICT (creator_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
          [creator.creator_id, subGrossKobo, platformFeeKobo, netKobo, paymentId]
        );
        await tx.query(
          `UPDATE users
           SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1, updated_at = NOW()
           WHERE id = $2`,
          [netKobo, creator.creator_id]
        );
      }

      // BUG-PAY-01: seed Creator Fund for room_subscription payments (was missing)
      const subCreatorFundKobo = Math.floor(subGrossKobo * 0.05);
      if (subCreatorFundKobo > 0) {
        await tx.query(
          `INSERT INTO x_manifest (key, value, updated_at)
           VALUES ('creator_fund_balance_kobo', $1::TEXT, NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT,
                 updated_at = NOW()`,
          [subCreatorFundKobo]
        );
      }
      return;
    }

    // Drop-room entry payment — payment is already marked completed above.
    // The join route validates payment.status='completed'; no coin credit needed.
    if (itemType === "room_entry") {
      // BUG-PAY-02: seed Creator Fund for room_entry payments (was missing)
      const entryCreatorFundKobo = Math.floor(amount * 0.05);
      if (entryCreatorFundKobo > 0) {
        await tx.query(
          `INSERT INTO x_manifest (key, value, updated_at)
           VALUES ('creator_fund_balance_kobo', $1::TEXT, NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT,
                 updated_at = NOW()`,
          [entryCreatorFundKobo]
        );
      }
      return;
    }

    // Business tier upgrade — activate the pending tier on the business account
    if (itemType === "business_upgrade") {
      const { businessAccountId, newTier } = metadata;
      if (!businessAccountId || !newTier) {
        console.error(`[webhook/paystack] business_upgrade missing businessAccountId or newTier in metadata`, { reference, metadata });
        return;
      }

      const activationResult = await tx.query(
        `UPDATE business_accounts
         SET tier = $1,
             pending_tier = NULL,
             pending_payment_ref = NULL,
             tier_updated_at = NOW(),
             updated_at = NOW()
         WHERE id = $2 AND pending_payment_ref = $3`,
        [newTier, businessAccountId, reference]
      );

      // BIZ-TIER-RACE: if pending_payment_ref no longer matches (e.g. a newer
      // upgrade request overwrote it, or it was already activated by a prior
      // webhook delivery), the activation UPDATE matches zero rows. Sending
      // the "upgraded" notification anyway would be a false success — raise
      // a system_alert for manual reconciliation instead.
      if (activationResult.rowCount === 0) {
        console.error(
          `[webhook/paystack] business_upgrade activation matched 0 rows (stale or already-applied reference)`,
          { reference, businessAccountId, newTier }
        );
        await tx.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('business_upgrade_activation_mismatch', 'warning', $1, $2::jsonb, NOW())`,
          [
            `Business upgrade activation for account ${businessAccountId} matched 0 rows (reference ${reference})`,
            JSON.stringify({ businessAccountId, newTier, reference }),
          ]
        );
        return;
      }

      // Notify the user
      await tx.query(
        `INSERT INTO notifications
           (user_id, type, title, body, metadata, is_read, created_at)
         SELECT user_id, 'business_tier_activated',
                'Business Account Upgraded',
                $1,
                $2::jsonb, false, NOW()
         FROM business_accounts WHERE id = $3`,
        [
          `Your business account has been upgraded to the ${newTier.charAt(0).toUpperCase() + newTier.slice(1)} tier.`,
          JSON.stringify({ businessAccountId, tier: newTier, reference }),
          businessAccountId,
        ]
      );
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

      // Capture params for post-transaction referral commission award (B12 — reduces hot-path lock time)
      referralPayload = { userId, coins: serverCoinsGranted, paymentId, amountKobo: amount };
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

  // Award referral commissions after the transaction commits so commission writes
  // do not extend the hot-path lock hold time (B12).
  // Type assertion needed because TS narrows `let` vars assigned inside async callbacks to their
  // initial type (null) after the await; the runtime value is correct.
  const capturedReferral = referralPayload as { userId: string; coins: number; paymentId: string; amountKobo: number } | null;
  if (capturedReferral) {
    await awardReferralCommissions(db, capturedReferral.userId, capturedReferral.coins, capturedReferral.paymentId, capturedReferral.amountKobo)
      .catch((err) => console.error("[webhook/paystack] Referral commission error:", err));
  }
}

// ---------------------------------------------------------------------------
// Helper: process transfer status updates (payout webhook)
// ---------------------------------------------------------------------------

export async function processTransferEvent(
  event: PaystackTransferEvent
): Promise<void> {
  const { reference, status, transfer_code } = event.data;

  // Look up payout by provider_reference (merchant reference stored at initiation)
  const { rows } = await db.query<{
    id: string;
    creator_id: string;
    gross_kobo: number;
    net_kobo: number;
    retry_count: number;
  }>(
    `SELECT id, creator_id, gross_kobo, net_kobo, retry_count
     FROM creator_payouts
     WHERE provider_reference = $1
     LIMIT 1`,
    [reference]
  );

  if (!rows[0]) {
    console.warn(`[webhook/paystack] No payout found for transfer reference: ${reference}`);
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
    const manifest = await loadManifest();
    const maxRetries = manifest.payouts.maxRetries;

    const newRetryCount = payout.retry_count + 1;

    if (newRetryCount >= maxRetries) {
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
          [payout.net_kobo, payout.creator_id]
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

export async function processSubscriptionEvent(
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

  // Map Paystack status to internal plan status.
  // non-renewing = paid-up but will not auto-renew; user keeps access until period end.
  // completed / cancelled = hard cancellation; downgrade immediately.
  const isActive = status === "active";
  const isNonRenewing = status === "non-renewing";
  const isCancelled = status === "cancelled" || status === "completed";

  if (event.event === "subscription.create") {
    // Derive plan tier first so it can be included in the subscription upsert (B-11)
    const planNameLower = (event.data.plan?.name ?? "").toLowerCase();
    const planCodeLower = (event.data.plan?.plan_code ?? "").toLowerCase();
    const planMatches = (keyword: string): boolean =>
      new RegExp(`\\b${keyword}\\b`).test(planNameLower) || planCodeLower.includes(keyword);
    const derivedPlan: string | null = planMatches("max")
      ? "max"
      : planMatches("plus")
      ? "plus"
      : planMatches("pro")
      ? "pro"
      : null;

    if (!derivedPlan) {
      console.error(
        `[webhook/paystack] Unrecognised plan name '${event.data.plan?.name}' for subscription ${subscription_code}. No plan activated.`
      );
      await db.query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('unknown_plan_code', 'critical', $1, $2::jsonb, NOW())`,
        [
          `Unknown Paystack plan name: ${event.data.plan?.name}`,
          JSON.stringify({ subscriptionCode: subscription_code, planName: event.data.plan?.name, userId: resolvedUserId }),
        ]
      ).catch(() => {});
      return;
    }

    const endsAt = next_payment_date
      ? new Date(next_payment_date).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Upsert canonical subscription record (B-11)
    await db.query(
      `INSERT INTO subscriptions
         (user_id, plan, provider, provider_subscription_id, status, starts_at, ends_at, updated_at)
       VALUES ($1, $2, 'paystack', $3, $4, NOW(), $5, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET plan = $2, provider_subscription_id = $3, status = $4, ends_at = $5, updated_at = NOW()`,
      [resolvedUserId, derivedPlan, subscription_code, isActive ? "active" : "inactive", endsAt]
    ).catch((err) => console.error("[webhook/paystack] subscriptions upsert failed:", err));

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
      // Swallow unique constraint violations (23505) — they mean the CRON already awarded
      // the bonus for this month, which is the correct outcome. All other errors are
      // rethrown so the webhook handler can mark the delivery as failed (BUG-PAY-02).
      const pgCode = (err as { code?: string })?.code;
      if (pgCode === '23505') {
        console.info('[webhook/paystack] subscription_bonus already awarded this month (23505) — skipping');
      } else {
        console.error("[webhook/paystack] Transaction error for subscription bonus:", err);
        throw err;
      }
    });

  } else if (event.event === "subscription.disable") {
    // BUG-05: check subscription.disable BEFORE isNonRenewing / isCancelled.
    // When Paystack sends subscription.disable with status="cancelled" the isCancelled
    // flag is true, but we must NOT immediately downgrade — the user paid for the
    // current period. Treat like non-renewing: mark disabled so the daily CRON
    // downgrades plan when ends_at (next_payment_date) lapses.
    const disableEndsAt = next_payment_date
      ? new Date(next_payment_date).toISOString()
      : null;

    await db.query(
      `UPDATE subscriptions
       SET status = 'disabled',
           auto_renew = false,
           ends_at = $2,
           updated_at = NOW()
       WHERE user_id = $1`,
      [resolvedUserId, disableEndsAt ?? null]
    ).catch(() => {});

  } else if (isNonRenewing) {
    // Subscription will not renew but is still active until period end.
    // Set auto_renew=false; daily cron downgrades plan when ends_at lapses.
    await db.query(
      `UPDATE subscriptions
       SET auto_renew = false, updated_at = NOW()
       WHERE user_id = $1`,
      [resolvedUserId]
    ).catch(() => {});

  } else if (isCancelled) {
    // Hard cancellation — downgrade immediately
    await db.query(
      `UPDATE subscriptions
       SET status = 'cancelled', updated_at = NOW()
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
  } else if (event.event === "subscription.disable") {
    notifType = "subscription_disabled";
    notifTitle = "Subscription Disabled";
    const endDate = next_payment_date
      ? new Date(next_payment_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : null;
    notifBody = endDate
      ? `Your subscription has been disabled. You will continue to have access until ${endDate}.`
      : "Your subscription has been disabled.";
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
// Dispatch function used by the failed-webhook retry cron
// ---------------------------------------------------------------------------

export async function handlePaystackWebhookPayload(
  eventType: string,
  payload: unknown
): Promise<void> {
  switch (eventType) {
    case "charge.success":
      await processChargeSuccess((payload as PaystackChargeEvent).data);
      break;

    case "transfer.success":
    case "transfer.failed":
    case "transfer.reversed":
      await processTransferEvent(payload as PaystackTransferEvent);
      break;

    case "subscription.create":
    case "subscription.not_renew":
    case "subscription.disable":
      await processSubscriptionEvent(payload as PaystackSubscriptionEvent);
      break;

    default:
      console.info(`[webhook/paystack] Ignoring unhandled event: ${eventType}`);
  }
}
