/**
 * lib/payments/dodoWebhookHandler.ts
 *
 * Shared DodoPayments webhook payload processing logic used by both:
 *   - app/api/economy/webhooks/dodopayments/route.ts (live webhook ingestion)
 *   - app/api/cron/daily/route.ts (failed-webhook retry queue)
 */

import { db } from "@/lib/db";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { awardReferralCommissions } from "@/lib/referrals/commissions";
import { moveToDeadLetterQueue, getCreatorFeeRate } from "@/lib/payments/payouts";

// ---------------------------------------------------------------------------
// DodoPayments webhook event types
// ---------------------------------------------------------------------------

export interface DodoPaymentSucceededEvent {
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
      itemType: "coin_pack" | "star_pack" | "subscription" | "room_subscription" | "business_upgrade";
      packName?: string;
      businessAccountId?: string;
      newTier?: string;
      idempotencyKey: string;
      planId?: string;
      planName?: string;
      interval?: string;
      type?: string;
    };
    created_at: string;
  };
}

export interface DodoPayoutEvent {
  event: "payout.completed" | "payout.failed";
  data: {
    id: string;
    reference: string;
    status: string;
    amount: number;
    currency: string;
  };
}

export type DodoEvent = DodoPaymentSucceededEvent | DodoPayoutEvent;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function processPaymentSucceeded(
  data: DodoPaymentSucceededEvent["data"]
): Promise<void> {
  const { id: providerReference, metadata, amount } = data;

  // Capture referral commission params from within the transaction so we can
  // fire awardReferralCommissions after the transaction commits (B12).
  let referralPayload: { userId: string; coins: number; paymentId: string; amountSmallestUnit: number } | null = null;

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
        `INSERT INTO failed_webhooks (provider, event_type, payload, error, created_at)
         VALUES ('dodopayments', 'payment.succeeded', $1::jsonb, $2, NOW())`,
        [JSON.stringify({ paymentId, metadata }), 'coin_pack_zero_grant']
      ).catch(() => {});
      return;
    }

    // Business tier upgrade — activate the pending tier on the business account
    if (itemType === "business_upgrade") {
      const { businessAccountId, newTier, reference } = metadata as unknown as {
        businessAccountId?: string;
        newTier?: string;
        reference?: string;
      };
      if (!businessAccountId || !newTier) {
        console.error(`[webhook/dodopayments] business_upgrade missing businessAccountId or newTier`, { providerReference, metadata });
        return;
      }

      const paymentRef = reference ?? providerReference;

      const activationResult = await tx.query(
        `UPDATE business_accounts
         SET tier = $1,
             pending_tier = NULL,
             pending_payment_ref = NULL,
             tier_updated_at = NOW(),
             updated_at = NOW()
         WHERE id = $2 AND pending_payment_ref = $3`,
        [newTier, businessAccountId, paymentRef]
      );

      // BIZ-TIER-RACE: zero rows matched means pending_payment_ref was stale
      // (overwritten by a newer upgrade request, or already activated by a
      // prior webhook delivery) — sending the notification anyway would be a
      // false success. Raise a system_alert for manual reconciliation.
      if (activationResult.rowCount === 0) {
        console.error(
          `[webhook/dodopayments] business_upgrade activation matched 0 rows (stale or already-applied reference)`,
          { paymentRef, businessAccountId, newTier }
        );
        await tx.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('business_upgrade_activation_mismatch', 'warning', $1, $2::jsonb, NOW())`,
          [
            `Business upgrade activation for account ${businessAccountId} matched 0 rows (reference ${paymentRef})`,
            JSON.stringify({ businessAccountId, newTier, reference: paymentRef }),
          ]
        );
        return;
      }

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
          JSON.stringify({ businessAccountId, tier: newTier, reference: paymentRef }),
          businessAccountId,
        ]
      );
      return;
    }

    // VIP room subscription — activate room access
    if (itemType === "room_subscription") {
      let { roomId, grossKobo: subGrossKobo, subscriptionDays = 30 } = metadata as unknown as {
        roomId: string;
        grossKobo: number;
        subscriptionDays?: number;
      };

      // BUG-PAY-05: validate roomId is a UUID before querying to prevent DB errors
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!roomId || !UUID_RE.test(roomId)) {
        console.error(`[webhook/dodopayments] room_subscription has invalid roomId: ${roomId}`, { paymentId, metadata });
        return;
      }

      // BUG-PAY-05: verify the room exists before inserting subscription
      const roomCheck = await tx.query(
        `SELECT id FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [roomId]
      );
      if (!roomCheck.rows[0]) {
        console.warn(`[webhook/dodopayments] Room ${roomId} not found, skipping room subscription`);
        roomId = null as unknown as string;
      }

      if (!roomId) return;

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
        const feeRate = getCreatorFeeRate(creator.creator_tier);
        const sharePercent = Math.round((1 - feeRate) * 100);
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
      const VALID_PLANS = ["plus", "pro", "max"] as const;
      // BUG-C02: Never fall back to a default plan — an unrecognised plan name
      // means the provider's catalogue diverged from ours. Alert and abort so no
      // user receives an unintended tier upgrade.
      const rawPlanName = metadata.planName ?? "";
      if (!VALID_PLANS.includes(rawPlanName as (typeof VALID_PLANS)[number])) {
        console.error(
          `[webhook/dodopayments] Unrecognised plan name: "${rawPlanName}" — aborting subscription activation`,
          { providerReference, metadata }
        );
        await tx.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('unknown_dodo_plan', 'warning', $1, $2::jsonb, NOW())`,
          [
            `Unknown DodoPayments plan name: "${rawPlanName}"`,
            JSON.stringify({ providerReference, rawPlanName, metadata }),
          ]
        ).catch(() => {});
        return;
      }
      const planName = rawPlanName as (typeof VALID_PLANS)[number];

      // BUG-14: use metadata.interval to compute ends_at instead of hard-coding 1 month.
      // Common DodoPayments interval values: "monthly", "yearly", "6month".
      const intervalMonths = (() => {
        switch ((metadata.interval ?? "monthly").toLowerCase()) {
          case "yearly":
          case "annual":
            return 12;
          case "6month":
          case "semi-annual":
            return 6;
          case "3month":
          case "quarterly":
            return 3;
          default:
            return 1;
        }
      })();
      const endsAt = new Date();
      endsAt.setMonth(endsAt.getMonth() + intervalMonths);

      // Write to subscriptions (canonical table) — B-12
      await tx.query(
        `INSERT INTO subscriptions
           (user_id, plan, status, provider, provider_subscription_id, starts_at, ends_at, created_at, updated_at)
         VALUES ($1, $2, 'active', 'dodopayments', $3, NOW(), $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET plan = $2, status = 'active', provider = 'dodopayments',
               provider_subscription_id = $3, ends_at = $4, updated_at = NOW()`,
        [userId, planName, providerReference, endsAt.toISOString()]
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
        // Dedup key scoped to plan + user + calendar month so re-deliveries don't double-credit.
        // DODO-SUB-BONUS: no .catch(23505) wrapper needed here (unlike the legacy pattern in
        // paystackWebhookHandler.ts) — creditCoins/writeLedgerEntry now resolves duplicate
        // (user_id, transaction_type, reference_id) inserts internally via ON CONFLICT DO NOTHING
        // and simply skips the balance update, so a re-delivered webhook never throws and never
        // rolls back the already-applied plan upgrade above.
        const monthKey = `plan:${userId}:${new Date(data.created_at).toISOString().slice(0, 7)}`;
        await creditCoins(
          userId,
          bonusCoins,
          "subscription_bonus",
          monthKey,
          `${planName} plan subscription — monthly coin bonus`,
          { plan: planName },
          tx
        );
      }
    } else if (itemType === "star_pack") {
      if (serverStarsGranted <= 0) {
        // BUG-PAY-04: throwing here rolls back the entire transaction including the payment
        // status update, so the webhook retries forever. Write to DLQ and return instead.
        console.error(`[webhook/dodopayments] star_pack has zero/negative stars for payment ${paymentId}`, { metadata });
        await tx.query(
          `INSERT INTO failed_webhooks (provider, event_type, payload, error, created_at)
           VALUES ('dodopayments', 'payment.succeeded', $1::jsonb, $2, NOW())`,
          [JSON.stringify({ paymentId, metadata }), `star_pack_zero_grant: got ${serverStarsGranted}`]
        ).catch(() => {});
        return;
      }
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
      if (serverCoinsGranted <= 0) {
        // Zero-coin grant would be a no-op credit but could still throw; log to DLQ and skip.
        console.error(
          `[webhook/dodopayments] coin_pack payment ${paymentId} resolved to 0 coins — queued for review`,
          { paymentId, metadata }
        );
        await tx.query(
          `INSERT INTO failed_webhooks (provider, event_type, payload, error, created_at)
           VALUES ('dodopayments', 'payment.succeeded', $1::jsonb, $2, NOW())`,
          [JSON.stringify({ paymentId, metadata }), 'coin_pack_zero_grant_post_db_resolve']
        ).catch(() => {});
        return; // do not throw — let the transaction commit with status=completed
      }

      await creditCoins(
        userId,
        serverCoinsGranted,
        "purchase",
        paymentId,
        `Purchased ${metadata.packName}`,
        { packId: metadata.packId, amountSmallestUnit: amount, currency: data.currency },
        tx
      );

      // Capture params for post-transaction referral commission award (B12 — reduces hot-path lock time)
      referralPayload = { userId, coins: serverCoinsGranted, paymentId, amountSmallestUnit: amount };
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
  const capturedReferral = referralPayload as { userId: string; coins: number; paymentId: string; amountSmallestUnit: number } | null;
  if (capturedReferral) {
    await awardReferralCommissions(db, capturedReferral.userId, capturedReferral.coins, capturedReferral.paymentId, capturedReferral.amountSmallestUnit)
      .catch((err) => console.error("[webhook/dodo] Referral commission error:", err));
  }
}

export async function processPayoutEvent(event: DodoPayoutEvent): Promise<void> {
  const { reference, status } = event.data;

  if (event.event === "payout.completed") {
    await db.query(
      `UPDATE creator_payouts
       SET status = 'completed', provider_status = $1, updated_at = NOW()
       WHERE provider_reference = $2`,
      [status, reference]
    );
    return;
  }

  // payout.failed — look up the payout to restore the creator's earnings via DLQ
  const { rows } = await db.query<{ id: string; creator_id: string; retry_count: number }>(
    `SELECT id, creator_id, retry_count FROM creator_payouts WHERE provider_reference = $1 LIMIT 1`,
    [reference]
  );
  const payout = rows[0];
  if (!payout) {
    console.warn(`[webhook/dodopayments] payout.failed for unknown reference: ${reference}`);
    return;
  }

  await moveToDeadLetterQueue(
    payout.id,
    payout.creator_id,
    payout.retry_count,
    `DodoPayments payout.failed: provider status = ${status}`
  );
}

// ---------------------------------------------------------------------------
// Dispatch function used by the failed-webhook retry cron
// ---------------------------------------------------------------------------

export async function handleDodoWebhookPayload(
  eventType: string,
  payload: unknown
): Promise<void> {
  switch (eventType) {
    case "payment.succeeded":
      await processPaymentSucceeded((payload as DodoPaymentSucceededEvent).data);
      break;

    case "payout.completed":
    case "payout.failed":
      await processPayoutEvent(payload as DodoPayoutEvent);
      break;

    default:
      console.info(`[webhook/dodopayments] Ignoring unhandled event: ${eventType}`);
  }
}
