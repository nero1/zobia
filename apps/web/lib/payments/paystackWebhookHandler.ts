/**
 * lib/payments/paystackWebhookHandler.ts
 *
 * Shared Paystack webhook payload processing logic used by both:
 *   - app/api/economy/webhooks/paystack/route.ts (live webhook ingestion)
 *   - app/api/cron/daily/route.ts (failed-webhook retry queue)
 */

import Decimal from "decimal.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { creditCoins } from "@/lib/economy/coins";
import { creditAdWallet } from "@/lib/economy/adWallet";
import { creditStars } from "@/lib/economy/stars";
import { awardReferralCommissions, recordFailedCommission } from "@/lib/referrals/commissions";
import { getCreatorFeeRate, moveToDeadLetterQueue } from "@/lib/payments/payouts";
import { loadManifest } from "@/lib/manifest";
import { contributeToCreatorFund } from "@/lib/creator/fundContribution";
import { logger } from "@/lib/logger";
import { BUSINESS_BILLING_PERIOD_DAYS } from "@/lib/business/limits";
import { raiseAlert } from "@/lib/alerts/dispatch";
import { awardEnrolmentXp, finalizeEnrolment, loadEnrolmentRoom } from "@/lib/classroom/enrolment";
import { insertNotification } from "@/lib/notifications/insert";

// NOTE ON THIS FILE'S MIGRATION STATUS: `processChargeSuccess` (and the
// inner subscription-bonus transaction inside `processSubscriptionEvent`)
// previously ran on the legacy raw adapter (`db.transaction`/`tx.query`)
// because they must stay atomic with `creditCoins` (lib/economy/coins.ts),
// `creditStars` (lib/economy/stars.ts), `creditAdWallet`
// (lib/economy/adWallet.ts), `contributeToCreatorFund`
// (lib/creator/fundContribution.ts), `loadEnrolmentRoom`/`finalizeEnrolment`
// (lib/classroom/enrolment.ts), and `raiseAlert` (lib/alerts/dispatch.ts).
// All of those have now been converted to accept a Drizzle `DbOrTx`, so both
// transactions below run on `orm.transaction()` (a single Drizzle-wrapped
// pg.Pool connection, same as everywhere else) and every call inside them
// shares that same connection/transaction — atomicity is preserved.

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
      itemType: "coin_pack" | "star_pack" | "subscription" | "room_subscription" | "room_entry" | "classroom_enrolment" | "business_upgrade" | "business_signup" | "business_renewal";
      /** Set on classroom_enrolment payments (POST /api/classroom/[roomId]/enroll, card). */
      roomId?: string;
      packName: string;
      businessAccountId?: string;
      newTier?: string;
      businessName?: string;
      businessType?: string | null;
      tier?: string;
      /** Set on POST /api/economy/subscriptions payments — see the itemType === "subscription" branch below. */
      planName?: string;
      interval?: "monthly" | "annual";
      /** "ad_wallet" routes a coin_pack credit to the Ad Wallet instead of coin_balance. */
      destination?: "main_wallet" | "ad_wallet";
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
    // BUG-029 FIX: createdAt is provided by Paystack on all subscription events.
    // Used to derive a stable month key that doesn't shift at midnight.
    createdAt?: string;
  };
}

export interface PaystackCustomerIdentificationEvent {
  event: "customeridentification.success" | "customeridentification.failed";
  data: {
    customer_id?: number;
    customer_code: string;
    email?: string;
    identification?: {
      country?: string;
      type?: string;
      bvn?: string;
      account_number?: string;
      bank_code?: string;
    };
    reason?: string;
  };
}

export type PaystackEvent =
  | PaystackChargeEvent
  | PaystackTransferEvent
  | PaystackSubscriptionEvent
  | PaystackCustomerIdentificationEvent;

// ---------------------------------------------------------------------------
// Helper: process a successful charge
// ---------------------------------------------------------------------------

export async function processChargeSuccess(
  data: PaystackChargeEvent["data"]
): Promise<void> {
  const { reference, metadata, amount } = data;

  // Capture referral commission params from within the transaction so we can
  // fire awardReferralCommissions after the transaction commits (B12).
  let referralPayload: {
    userId: string;
    coins: number;
    paymentId: string;
    amountKobo: number;
    crypto: { currency: string; chain: string; expectedBaseUnits: string } | null;
  } | null = null;
  let classroomEnrolmentXp: { roomId: string; userId: string } | null = null;

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    // Idempotency guard — check if this reference was already processed
    const existing = await tx
      .select({
        id: schema.payments.id,
        status: schema.payments.status,
        provider: schema.payments.provider,
        chain: schema.payments.chain,
        tokenSymbol: schema.payments.tokenSymbol,
        expectedTokenAmount: schema.payments.expectedTokenAmount,
      })
      .from(schema.payments)
      .where(eq(schema.payments.providerReference, reference))
      .for("update");

    if (!existing[0]) {
      logger.error({ reference }, "[webhook/paystack] No payment record for reference");
      return;
    }

    if (existing[0].status === "completed") {
      logger.info({ reference }, "[webhook/paystack] Duplicate event for reference");
      return;
    }

    // Mark payment as completed — BUG-027 FIX: include updated_at = NOW()
    await tx
      .update(schema.payments)
      .set({ status: "completed", completedAt: sql`NOW()`, amountReceivedKobo: BigInt(amount), updatedAt: sql`NOW()` })
      .where(eq(schema.payments.providerReference, reference));

    const paymentId = existing[0].id;
    const { userId, coinsGranted, starsGranted, itemType } = metadata;

    // Admin test payment (POST /api/admin/payments/test) — just confirms the
    // provider integration works end-to-end. Not a real purchase: no coins/
    // stars to credit and it must not count toward Creator Fund revenue.
    if ((metadata as Record<string, unknown>).adminTest) {
      return;
    }

    // Subscription charges — plan activation.
    //
    // This used to defer activation to a Paystack `subscription.create` event
    // and just return here. That event only fires for a true Paystack
    // recurring Subscription object (created with a `plan` code), but
    // POST /api/economy/subscriptions initiates a plain one-off
    // `/transaction/initialize` charge with no `plan` attached — so
    // `subscription.create` never fires, and a plan purchase/change would
    // charge the user successfully but never actually update their plan.
    // Our own billing period tracking (subscriptions.ends_at, swept daily by
    // lib/plans/subscriptionSweep.ts) doesn't need a real Paystack
    // Subscription object anyway. Mirrors the `itemType === "subscription"`
    // branch handling used by other provider integrations.
    if (itemType === "subscription") {
      const VALID_PLANS = ["plus", "pro", "max"] as const;
      const rawPlanName = metadata.planName ?? "";
      if (!VALID_PLANS.includes(rawPlanName as (typeof VALID_PLANS)[number])) {
        logger.error(
          { rawPlanName, reference, metadata },
          "[webhook/paystack] Unrecognised plan name — aborting subscription activation"
        );
        await raiseAlert(tx, {
          type: "unknown_paystack_plan",
          category: "financial",
          priorityLevel: 3,
          title: "Unknown Paystack plan name",
          message: `Unknown Paystack plan name: "${rawPlanName}"`,
          metadata: { reference, rawPlanName, metadata },
          dedupeKey: `unknown_paystack_plan:${rawPlanName}`,
        }).catch(() => {});
        return;
      }
      const planName = rawPlanName as (typeof VALID_PLANS)[number];

      const billingPeriod = (metadata as Record<string, unknown>).interval === "annual" ? "annual" : "monthly";
      const endsAt = new Date();
      if (billingPeriod === "annual") {
        endsAt.setFullYear(endsAt.getFullYear() + 1);
      } else {
        endsAt.setMonth(endsAt.getMonth() + 1);
      }

      await tx
        .insert(schema.subscriptions)
        .values({
          userId,
          plan: planName,
          billingPeriod,
          status: "active",
          provider: "paystack",
          providerSubscriptionId: reference,
          startsAt: sql`NOW()`,
          endsAt: new Date(endsAt),
          updatedAt: sql`NOW()`,
        })
        .onConflictDoUpdate({
          target: schema.subscriptions.userId,
          set: {
            plan: planName,
            billingPeriod,
            status: "active",
            provider: "paystack",
            providerSubscriptionId: reference,
            cancelledAt: null,
            endsAt: new Date(endsAt),
            updatedAt: sql`NOW()`,
          },
        });

      await tx.update(schema.users).set({ plan: planName, updatedAt: sql`NOW()` }).where(eq(schema.users.id, userId));

      // Award monthly subscription bonus coins (PRD §3) — dedup key scoped to
      // plan + user + calendar month so a re-delivered webhook (or the
      // separate daily-economy CRON's own monthly bonus pass) never double-credits.
      const MONTHLY_PLAN_BONUS: Record<string, number> = { plus: 50, pro: 200, max: 500 };
      const bonusCoins = MONTHLY_PLAN_BONUS[planName];
      if (bonusCoins && bonusCoins > 0) {
        const monthKey = `plan:${userId}:${new Date().toISOString().slice(0, 7)}`;
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
        logger.error({ reference, rawMeta }, "[webhook/paystack] room_subscription metadata missing required fields");
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
        const roomCheck = await tx
          .select({ id: schema.rooms.id })
          .from(schema.rooms)
          .where(and(eq(schema.rooms.id, roomId), isNull(schema.rooms.deletedAt)))
          .limit(1);
        if (!roomCheck[0]) {
          logger.warn({ roomId, reference }, "[paystackWebhook] Room not found, skipping room subscription");
          roomId = null;
        }
      }

      if (!roomId) {
        return;
      }

      await tx
        .insert(schema.roomSubscriptions)
        .values({
          roomId,
          userId,
          status: "active",
          amountKobo: BigInt(subGrossKobo),
          startedAt: sql`NOW()`,
          expiresAt: new Date(expiresAt),
        })
        .onConflictDoUpdate({
          target: [schema.roomSubscriptions.roomId, schema.roomSubscriptions.userId],
          set: { status: "active", amountKobo: BigInt(subGrossKobo), startedAt: sql`NOW()`, expiresAt: new Date(expiresAt) },
        });

      await tx
        .insert(schema.roomMembers)
        .values({ roomId, userId, role: "member", joinedAt: sql`NOW()` })
        .onConflictDoNothing({ target: [schema.roomMembers.roomId, schema.roomMembers.userId] });

      // Credit creator earnings
      const roomRow = await tx
        .select({ creatorId: schema.rooms.creatorId, creatorTier: schema.users.creatorTier })
        .from(schema.rooms)
        .innerJoin(schema.users, eq(schema.users.id, schema.rooms.creatorId))
        .where(eq(schema.rooms.id, roomId));
      const creator = roomRow[0];
      if (creator) {
        const feeRate = getCreatorFeeRate(creator.creatorTier);
        // Use Decimal.js to avoid IEEE 754 float errors on kobo arithmetic (BUG-FIN-01).
        const netKobo = new Decimal(subGrossKobo).mul(new Decimal(1).minus(feeRate)).floor().toNumber();
        const platformFeeKobo = subGrossKobo - netKobo;
        await tx
          .insert(schema.creatorEarnings)
          .values({
            creatorId: creator.creatorId,
            sourceType: "subscription",
            grossAmountKobo: BigInt(subGrossKobo),
            platformFeeKobo: BigInt(platformFeeKobo),
            netAmountKobo: BigInt(netKobo),
            referenceId: paymentId,
          })
          .onConflictDoNothing({
            target: [schema.creatorEarnings.creatorId, schema.creatorEarnings.referenceId],
            where: sql`${schema.creatorEarnings.referenceId} IS NOT NULL`,
          });
        await tx
          .update(schema.users)
          .set({ availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${netKobo}`, updatedAt: sql`NOW()` })
          .where(eq(schema.users.id, creator.creatorId));
      }

      // BUG-PAY-01: seed Creator Fund for room_subscription payments (was missing)
      await contributeToCreatorFund(subGrossKobo, "room_subscription", tx);
      return;
    }

    // Classroom enrolment paid by card — write the enrolment, membership and
    // creator earnings (lib/classroom/enrolment.ts, the same code path as a
    // Credits-balance enrolment). The fee is taken from what Paystack actually
    // charged (`amount`, kobo), never from client-supplied metadata.
    if (itemType === "classroom_enrolment") {
      const roomId = typeof metadata.roomId === "string" ? metadata.roomId : metadata.packId;
      if (!roomId || !userId) {
        logger.error({ reference, metadata }, "[webhook/paystack] classroom_enrolment missing roomId/userId");
        throw new Error(`classroom_enrolment webhook missing required metadata (reference: ${reference})`);
      }
      const room = await loadEnrolmentRoom(roomId, tx);
      const enrolmentId = await finalizeEnrolment(tx, { room, userId, paid: true, feeKobo: amount });
      if (!enrolmentId) {
        // Already enrolled (e.g. paid twice in two tabs) — flag for a manual refund.
        logger.error({ reference, userId, roomId }, "[webhook/paystack] classroom_enrolment for an already-enrolled user (possible duplicate charge)");
        await raiseAlert(tx, {
          type: "classroom_enrolment_duplicate_charge",
          category: "financial",
          priorityLevel: 3,
          title: "Possible duplicate classroom enrolment charge",
          message: `Classroom enrolment payment ${reference} completed for user ${userId} who was already enrolled in ${roomId} — requires manual refund review`,
          metadata: { userId, roomId, reference },
          dedupeKey: `classroom_enrolment_duplicate_charge:${reference}`,
        }).catch(() => {});
      } else {
        classroomEnrolmentXp = { roomId, userId };
      }
      await contributeToCreatorFund(amount, "room_entry", tx);
      return;
    }

    // Drop-room entry payment — payment is already marked completed above.
    // The join route validates payment.status='completed'; no coin credit needed.
    if (itemType === "room_entry") {
      // BUG-PAY-02: seed Creator Fund for room_entry payments (was missing)
      await contributeToCreatorFund(amount, "room_entry", tx);
      return;
    }

    // Business Starter signup — create the business_accounts row now that
    // payment has cleared (PRD §17: Starter is a paid tier, not free).
    if (itemType === "business_signup") {
      const { businessName, businessType, tier: signupTier } = metadata;
      if (!businessName) {
        logger.error({ reference, metadata }, "[webhook/paystack] business_signup missing businessName in metadata");
        return;
      }
      const tier = ["starter", "growth", "enterprise"].includes(signupTier as string) ? (signupTier as string) : "starter";

      // NOTE (schema gap): `business_accounts.current_period_ends_at` is not
      // modeled in lib/db/schema.ts — this insert therefore goes through
      // Drizzle's `sql` tagged template via `.execute()` (still the shared
      // Drizzle-wrapped pg.Pool, still fully parameterised) instead of the
      // query builder. Report this gap — do not edit schema.ts here.
      //
      // Idempotent: business_accounts.user_id is UNIQUE, so a replayed webhook
      // (or a race with a second signup attempt) simply no-ops here.
      const createdResult = await tx.execute<{ id: string }>(sql`
        INSERT INTO business_accounts
           (user_id, business_name, business_type, tier, verified, status, current_period_ends_at, created_at, updated_at)
         VALUES (${userId}, ${businessName}, ${businessType ?? null}, ${tier}, FALSE, 'active', NOW() + (${String(BUSINESS_BILLING_PERIOD_DAYS)} || ' days')::interval, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING
         RETURNING id
      `);
      const createdRows = createdResult.rows;

      if (!createdRows[0]) {
        // The idempotency guard above (top of this function) only short-circuits
        // replays of THIS SAME reference — reaching here means a business
        // account already existed under a DIFFERENT completed payment, i.e.
        // the user was charged twice for signup (e.g. two checkout sessions
        // opened before the first webhook landed). Flag for manual refund.
        logger.error({ reference, userId }, "[webhook/paystack] business_signup — account already exists under a different payment (possible duplicate charge)");
        await raiseAlert(tx, {
          type: "business_signup_duplicate_charge",
          category: "financial",
          priorityLevel: 3,
          title: "Possible duplicate business signup charge",
          message: `Business signup payment ${reference} completed for user ${userId} who already has a business account — possible duplicate charge, requires manual refund review`,
          metadata: { userId, reference },
          dedupeKey: `business_signup_duplicate_charge:${reference}`,
        });
        return;
      }

      await tx.insert(schema.notifications).values({
        userId,
        type: "business_tier_activated",
        title: "Business Account Created",
        body: `Your Business ${tier.charAt(0).toUpperCase()}${tier.slice(1)} account is now active.`,
        metadata: { businessAccountId: createdRows[0].id, tier, reference },
        isRead: false,
      });
      return;
    }

    // Business tier upgrade — activate the pending tier on the business account
    if (itemType === "business_upgrade") {
      const { businessAccountId, newTier } = metadata;
      if (!businessAccountId || !newTier) {
        logger.error({ reference, metadata }, "[webhook/paystack] business_upgrade missing businessAccountId or newTier in metadata");
        return;
      }

      // NOTE (schema gap): `business_accounts.current_period_ends_at` is not
      // modeled in lib/db/schema.ts — see the business_signup branch above.
      const activationResult = await tx.execute(sql`
        UPDATE business_accounts
         SET tier = ${newTier},
             pending_tier = NULL,
             pending_payment_ref = NULL,
             tier_updated_at = NOW(),
             status = 'active',
             grace_period_ends_at = NULL,
             current_period_ends_at = NOW() + (${String(BUSINESS_BILLING_PERIOD_DAYS)} || ' days')::interval,
             updated_at = NOW()
         WHERE id = ${businessAccountId} AND pending_payment_ref = ${reference}
      `);

      // BIZ-TIER-RACE: if pending_payment_ref no longer matches (e.g. a newer
      // upgrade request overwrote it, or it was already activated by a prior
      // webhook delivery), the activation UPDATE matches zero rows. Sending
      // the "upgraded" notification anyway would be a false success — raise
      // a system_alert for manual reconciliation instead.
      if (activationResult.rowCount === 0) {
        logger.error({ reference, businessAccountId, newTier }, "[webhook/paystack] business_upgrade activation matched 0 rows (stale or already-applied reference)");
        await raiseAlert(tx, {
          type: "business_upgrade_activation_mismatch",
          category: "financial",
          priorityLevel: 3,
          title: "Business upgrade activation mismatch",
          message: `Business upgrade activation for account ${businessAccountId} matched 0 rows (reference ${reference})`,
          metadata: { businessAccountId, newTier, reference },
          dedupeKey: `business_upgrade_activation_mismatch:${businessAccountId}:${reference}`,
        });
        return;
      }

      // Notify the user
      const upgradedAccount = await tx
        .select({ userId: schema.businessAccounts.userId })
        .from(schema.businessAccounts)
        .where(eq(schema.businessAccounts.id, businessAccountId));
      if (upgradedAccount[0]) {
        await tx.insert(schema.notifications).values({
          userId: upgradedAccount[0].userId,
          type: "business_tier_activated",
          title: "Business Account Upgraded",
          body: `Your business account has been upgraded to the ${newTier.charAt(0).toUpperCase() + newTier.slice(1)} tier.`,
          metadata: { businessAccountId, tier: newTier, reference },
          isRead: false,
        });
      }
      return;
    }

    // Business Account renewal — manual "pay for another period" (Paystack
    // checkout doesn't auto-renew), extends current_period_ends_at and
    // recovers the account out of 'grace'/'suspended' back to 'active'.
    // See app/api/business/renew/route.ts.
    if (itemType === "business_renewal") {
      const rawMeta = metadata as unknown as { businessAccountId?: string };
      const businessAccountId = rawMeta.businessAccountId;
      if (!businessAccountId) {
        logger.error({ reference, metadata }, "[webhook/paystack] business_renewal missing businessAccountId in metadata");
        return;
      }

      // NOTE (schema gap): `business_accounts.current_period_ends_at` is not
      // modeled in lib/db/schema.ts — see the business_signup branch above.
      await tx.execute(sql`
        UPDATE business_accounts
         SET status = 'active',
             grace_period_ends_at = NULL,
             current_period_ends_at = GREATEST(COALESCE(current_period_ends_at, NOW()), NOW()) + (${String(BUSINESS_BILLING_PERIOD_DAYS)} || ' days')::interval,
             updated_at = NOW()
         WHERE id = ${businessAccountId}
      `);

      const renewedAccount = await tx
        .select({ userId: schema.businessAccounts.userId })
        .from(schema.businessAccounts)
        .where(eq(schema.businessAccounts.id, businessAccountId));
      if (renewedAccount[0]) {
        await tx.insert(schema.notifications).values({
          userId: renewedAccount[0].userId,
          type: "business_tier_activated",
          title: "Business Account Renewed",
          body: "Your business account subscription has been renewed.",
          metadata: { businessAccountId, reference },
          isRead: false,
        });
      }
      return;
    }

    // Re-derive grant amounts server-side from store_items to prevent metadata tampering
    let serverCoinsGranted = coinsGranted ?? 0;
    let serverStarsGranted = starsGranted ?? 0;
    if (metadata.packId) {
      const packRows = await tx
        .select({
          coinsGranted: schema.storeItems.coinsGranted,
          starsGranted: schema.storeItems.starsGranted,
          priceKobo: schema.storeItems.priceKobo,
          validUntil: schema.storeItems.validUntil,
        })
        .from(schema.storeItems)
        .where(eq(schema.storeItems.id, metadata.packId))
        .limit(1);
      if (packRows[0]) {
        // BUG-042/075: Reject if the item expired before the payment was made.
        // Use paid_at as the purchase time (not webhook arrival) to honor payments made before expiry.
        if (packRows[0].validUntil) {
          const paidAt = new Date(data.paid_at);
          const validUntil = new Date(packRows[0].validUntil);
          if (paidAt > validUntil) {
            logger.warn({ reference, packId: metadata.packId, paidAt, validUntil }, "[webhook/paystack] Purchase for expired store item — refunding");
            await tx
              .update(schema.payments)
              .set({ status: "failed", updatedAt: sql`NOW()` })
              .where(eq(schema.payments.providerReference, reference))
              .catch(() => {});
            await raiseAlert(tx, {
              type: "purchase_expired_item",
              category: "financial",
              priorityLevel: 3,
              title: "Purchase for expired store item",
              message: `Purchase ${reference} for expired item ${metadata.packId} — requires manual refund review`,
              metadata: { reference, packId: metadata.packId, paidAt, validUntil },
              dedupeKey: `purchase_expired_item:${reference}`,
            }).catch(() => {});
            return;
          }
        }
        if (packRows[0].coinsGranted != null) serverCoinsGranted = Number(packRows[0].coinsGranted);
        if (packRows[0].starsGranted != null) serverStarsGranted = packRows[0].starsGranted;

        // Bug #18: Reject underpayments — never credit if paid amount < pack price
        if (packRows[0].priceKobo != null && amount < packRows[0].priceKobo) {
          const priceKoboNum = Number(packRows[0].priceKobo);
          logger.warn({ reference, paidKobo: amount, priceKobo: priceKoboNum, packId: metadata.packId }, "[webhook/paystack] Underpayment detected — flagging for manual review");
          await tx
            .update(schema.payments)
            .set({ status: "underpaid", updatedAt: sql`NOW()` })
            .where(eq(schema.payments.providerReference, reference))
            .catch(() => {});
          await raiseAlert(tx, {
            type: "underpayment",
            category: "financial",
            priorityLevel: 2,
            title: "Underpayment detected",
            message: `Underpayment for reference ${reference}: paid ${amount}, expected ${priceKoboNum}`,
            metadata: { reference, amount, priceKobo: priceKoboNum, userId, packId: metadata.packId },
            dedupeKey: `underpayment:${reference}`,
          }).catch(() => {});
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
    } else if (serverCoinsGranted > 0 && metadata.destination === "ad_wallet") {
      await creditAdWallet(
        userId,
        serverCoinsGranted,
        "topup_purchase",
        paymentId,
        `Purchased ${metadata.packName} (Ad Wallet)`,
        { packId: metadata.packId, amountKobo: amount },
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
      const cryptoRow = existing[0];
      referralPayload = {
        userId,
        coins: serverCoinsGranted,
        paymentId,
        amountKobo: amount,
        crypto:
          cryptoRow.provider === "crypto" && cryptoRow.chain && cryptoRow.tokenSymbol && cryptoRow.expectedTokenAmount
            ? { currency: cryptoRow.tokenSymbol, chain: cryptoRow.chain, expectedBaseUnits: cryptoRow.expectedTokenAmount }
            : null,
      };
    }

    // Seed the Creator Fund from gross revenue (PRD §14; percent is admin-configurable)
    await contributeToCreatorFund(amount, "coin_purchase", tx);
  });

  // Award referral commissions after the transaction commits so commission writes
  // do not extend the hot-path lock hold time (B12).
  // Type assertion needed because TS narrows `let` vars assigned inside async callbacks to their
  // initial type (null) after the await; the runtime value is correct.
  const capturedReferral = referralPayload as {
    userId: string;
    coins: number;
    paymentId: string;
    amountKobo: number;
    crypto: { currency: string; chain: string; expectedBaseUnits: string } | null;
  } | null;
  if (capturedReferral) {
    try {
      await awardReferralCommissions(
        orm,
        capturedReferral.userId,
        capturedReferral.coins,
        capturedReferral.paymentId,
        capturedReferral.amountKobo,
        capturedReferral.crypto
      );
    } catch (err) {
      logger.error({ err, paymentId: capturedReferral.paymentId, userId: capturedReferral.userId }, "[webhook/paystack] Referral commission error — writing to DLQ");
      await recordFailedCommission(
        capturedReferral.paymentId,
        capturedReferral.userId,
        capturedReferral.coins,
        capturedReferral.amountKobo,
        "paystack",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // Classroom enrolment XP — fired only once the enrolment has committed
  // (safeAwardXP's documented contract).
  const capturedEnrolment = classroomEnrolmentXp as { roomId: string; userId: string } | null;
  if (capturedEnrolment) {
    awardEnrolmentXp(capturedEnrolment.roomId, capturedEnrolment.userId, true);
  }
}

// ---------------------------------------------------------------------------
// Helper: process transfer status updates (payout webhook)
// ---------------------------------------------------------------------------

export async function processTransferEvent(
  event: PaystackTransferEvent
): Promise<void> {
  const { reference, status, transfer_code } = event.data;

  // BUG-PAY-01 FIX: wrap the payout read and all subsequent status updates in a
  // single transaction with FOR UPDATE so the webhook handler and the CRON batch
  // processor mutually exclude each other on the same payout row. Without FOR UPDATE
  // both could read the row concurrently and double-increment retry_count or initiate
  // two Paystack transfer calls for the same payout.
  let payoutId: string | null = null;
  let creatorId: string | null = null;
  let netKobo: bigint = 0n;
  // Flags for post-transaction side effects (avoid calling moveToDeadLetterQueue
  // inside the outer tx — it opens its own transaction, causing a nested tx deadlock).
  let shouldMoveToDLQ = false;
  let dlqRetryCount = 0;
  let dlqReason = "";

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: schema.creatorPayouts.id,
        creatorId: schema.creatorPayouts.creatorId,
        grossKobo: schema.creatorPayouts.grossKobo,
        netKobo: schema.creatorPayouts.netKobo,
        retryCount: schema.creatorPayouts.retryCount,
      })
      .from(schema.creatorPayouts)
      .where(eq(schema.creatorPayouts.providerReference, reference))
      .limit(1)
      .for("update");

    if (!rows[0]) {
      logger.warn({ reference }, "[webhook/paystack] No payout found for transfer reference");
      return;
    }

    const payout = rows[0];
    payoutId = payout.id;
    creatorId = payout.creatorId;
    netKobo = payout.netKobo ?? 0n;

    if (event.event === "transfer.success") {
      await tx
        .update(schema.creatorPayouts)
        .set({ status: "completed", completedAt: sql`NOW()`, updatedAt: sql`NOW()` })
        .where(eq(schema.creatorPayouts.id, payout.id));

    } else if (event.event === "transfer.failed") {
      const manifest = await loadManifest();
      const maxRetries = manifest.payouts.maxRetries;

      const newRetryCount = payout.retryCount + 1;

      if (newRetryCount >= maxRetries) {
        // Mark payout as permanently failed within the transaction, then schedule
        // DLQ insertion and notification for after the transaction commits.
        await tx
          .update(schema.creatorPayouts)
          .set({ status: "failed", retryCount: newRetryCount, lastRetryAt: sql`NOW()`, updatedAt: sql`NOW()` })
          .where(eq(schema.creatorPayouts.id, payout.id));
        shouldMoveToDLQ = true;
        dlqRetryCount = newRetryCount;
        dlqReason = `Paystack transfer failed after ${maxRetries} attempts. Status: ${status}`;
      } else {
        // Exponential backoff: 5min, 15min, 45min
        const backoffMinutes = [5, 15, 45][Math.min(newRetryCount - 1, 2)];
        await tx
          .update(schema.creatorPayouts)
          .set({
            status: "failed",
            retryCount: newRetryCount,
            lastRetryAt: sql`NOW()`,
            nextRetryAt: sql`NOW() + (${backoffMinutes} || ' minutes')::INTERVAL`,
            updatedAt: sql`NOW()`,
          })
          .where(eq(schema.creatorPayouts.id, payout.id));
      }
    }
  });

  // Post-transaction: move to DLQ (opens its own transaction — must be outside outer tx).
  // moveToDeadLetterQueue already calls notifyPayoutFailure internally, so no separate call needed.
  if (shouldMoveToDLQ && payoutId && creatorId) {
    await moveToDeadLetterQueue(payoutId, creatorId, dlqRetryCount, dlqReason);
  }

  // Post-transaction notifications (no row lock needed)
  if (event.event === "transfer.success" && payoutId && creatorId) {
    await insertNotification(
      orm,
      creatorId,
      "payout_completed",
      "Payout Successful",
      "Your payout has been processed and is on its way to your bank account.",
      { payoutId, reference }
    ).catch(() => {});
  }

  if (event.event === "transfer.reversed" && payoutId && creatorId) {
    // Restore earnings to creator — guard with FOR UPDATE + earnings_restored flag
    // to prevent duplicate webhook deliveries from double-crediting (#8)
    await orm.transaction(async (tx) => {
      const cur = await tx
        .select({ status: schema.creatorPayouts.status, earningsRestored: schema.creatorPayouts.earningsRestored })
        .from(schema.creatorPayouts)
        .where(eq(schema.creatorPayouts.id, payoutId as string))
        .for("update");
      if (!cur[0] || cur[0].status === "reversed") return; // already handled

      await tx
        .update(schema.creatorPayouts)
        .set({ status: "reversed", updatedAt: sql`NOW()` })
        .where(eq(schema.creatorPayouts.id, payoutId as string));

      if (!cur[0].earningsRestored) {
        await tx
          .update(schema.creatorPayouts)
          .set({ earningsRestored: true })
          .where(eq(schema.creatorPayouts.id, payoutId as string));
        await tx
          .update(schema.users)
          .set({
            availableEarningsKobo: sql`${schema.users.availableEarningsKobo} + ${netKobo}`,
            updatedAt: sql`NOW()`,
          })
          .where(eq(schema.users.id, creatorId as string));
      }
    });

    // Notify creator of reversal
    await insertNotification(
      orm,
      creatorId,
      "payout_reversed",
      "Payout Reversed",
      "Your payout was reversed by the payment network. Your earnings have been restored to your balance. Please verify your bank account details.",
      { payoutId }
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

  const orm = await getDb();

  // Single email lookup — cache result to avoid duplicate DB round-trip (BUG-13)
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const rows = await orm
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, customer.email), isNull(schema.users.deletedAt)))
      .limit(1);
    resolvedUserId = rows[0]?.id ?? null;
    if (!resolvedUserId) {
      logger.warn({ email: customer.email }, "[webhook/paystack] Subscription event: no user found for email");
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
    // BUG-013: Split plan code by common delimiters so "pro" matches "zobia-pro-monthly"
    // but NOT "zobia-professional". Word-boundary regex handles plan name.
    const planCodeSegments = new Set(planCodeLower.split(/[-_.]/));
    const planMatches = (keyword: string): boolean =>
      new RegExp(`\\b${keyword}\\b`).test(planNameLower) ||
      planCodeSegments.has(keyword) ||
      planCodeLower === keyword;
    const derivedPlan: string | null = planMatches("max")
      ? "max"
      : planMatches("plus")
      ? "plus"
      : planMatches("pro")
      ? "pro"
      : null;

    if (!derivedPlan) {
      logger.error({ planName: event.data.plan?.name, subscriptionCode: subscription_code, userId: resolvedUserId }, "[webhook/paystack] Unrecognised plan name — no plan activated");
      await raiseAlert(orm, {
        type: "unknown_plan_code",
        category: "financial",
        priorityLevel: 2,
        title: "Unknown Paystack subscription plan code",
        message: `Unknown Paystack plan name: ${event.data.plan?.name}`,
        metadata: { subscriptionCode: subscription_code, planName: event.data.plan?.name, userId: resolvedUserId },
        dedupeKey: `unknown_plan_code:${subscription_code}`,
      }).catch(() => {});
      return;
    }

    const endsAt = next_payment_date
      ? new Date(next_payment_date).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Upsert canonical subscription record (B-11)
    await orm
      .insert(schema.subscriptions)
      .values({
        userId: resolvedUserId,
        plan: derivedPlan,
        provider: "paystack",
        providerSubscriptionId: subscription_code,
        status: isActive ? "active" : "inactive",
        startsAt: sql`NOW()`,
        endsAt: new Date(endsAt),
        updatedAt: sql`NOW()`,
      })
      .onConflictDoUpdate({
        target: schema.subscriptions.userId,
        set: {
          plan: derivedPlan,
          providerSubscriptionId: subscription_code,
          status: isActive ? "active" : "inactive",
          endsAt: new Date(endsAt),
          updatedAt: sql`NOW()`,
        },
      })
      .catch((err) => logger.error({ err }, "[webhook/paystack] subscriptions upsert failed"));

    // This inner transaction must stay atomic with `creditCoins`/`creditStars`.
    await orm.transaction(async (tx) => {
      // Update plan
      await tx.update(schema.users).set({ plan: derivedPlan, updatedAt: sql`NOW()` }).where(eq(schema.users.id, resolvedUserId));

      // Award monthly subscription bonus coins (PRD §3).
      // BUG-21: Key on `plan:{userId}:{YYYY-MM}` rather than subscription_code so
      // that the CRON's monthly_plan_bonus (which uses the same pattern) hits the same
      // dedup key and only one credit is issued when both fire on the 1st of the month.
      // BUG-029 FIX: derive YYYY-MM from the event's createdAt timestamp (set by
      // Paystack), not from new Date() (server wall-clock). Using new Date() causes a
      // midnight race: a webhook delivered at 23:59 on the 31st and retried at 00:01
      // on the 1st would produce two different monthKeys and double-award the bonus.
      // Including subscription_code in the key further prevents duplicate awards when
      // the same subscription fires multiple renewal events within the same month.
      const MONTHLY_PLAN_BONUS: Record<string, number> = { plus: 50, pro: 200, max: 500 };
      const bonusCoins = MONTHLY_PLAN_BONUS[derivedPlan];
      if (bonusCoins && bonusCoins > 0) {
        const eventMonthKey = new Date(event.data.createdAt ?? Date.now()).toISOString().slice(0, 7); // YYYY-MM
        const subscriptionCode = event.data.subscription_code;
        await creditCoins(
          resolvedUserId,
          bonusCoins,
          "subscription_bonus",
          `plan:${resolvedUserId}:${eventMonthKey}:${subscriptionCode}`,
          `${derivedPlan} plan subscription — monthly coin bonus`,
          { plan: derivedPlan },
          tx
        );
      }

      // Award subscription stars if the plan includes a star grant (BUG-56).
      const subscriptionStars = customer.metadata?.starsGranted ?? 0;
      if (subscriptionStars > 0) {
        const eventMonthKeyStars = new Date(event.data.createdAt ?? Date.now()).toISOString().slice(0, 7);
        await creditStars(
          resolvedUserId,
          subscriptionStars,
          "purchase",
          `plan:stars:${resolvedUserId}:${eventMonthKeyStars}`,
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
        logger.info({ userId: resolvedUserId }, "[webhook/paystack] subscription_bonus already awarded this month (23505) — skipping");
      } else {
        logger.error({ err, userId: resolvedUserId }, "[webhook/paystack] Transaction error for subscription bonus");
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

    if (!disableEndsAt) {
      logger.warn({ userId: resolvedUserId, subscriptionCode: subscription_code }, "[webhook/paystack] subscription.disable received without next_payment_date — falling back to NOW()");
    }

    // Use next_payment_date when present; fall back to the existing ends_at (if
    // already set), or NOW() as a last resort so the user never retains premium
    // indefinitely when both next_payment_date and ends_at are absent.
    const disableEndsAtDate: Date | null = disableEndsAt ? new Date(disableEndsAt) : null;
    await orm
      .update(schema.subscriptions)
      .set({
        status: "disabled",
        autoRenew: false,
        endsAt: sql`CASE
          WHEN ${disableEndsAtDate}::timestamptz IS NOT NULL THEN ${disableEndsAtDate}::timestamptz
          WHEN ${schema.subscriptions.endsAt} IS NOT NULL THEN ${schema.subscriptions.endsAt}
          ELSE NOW()
        END`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(schema.subscriptions.userId, resolvedUserId))
      .catch(() => {});

  } else if (isNonRenewing) {
    // Subscription will not renew but is still active until period end.
    // Set auto_renew=false; daily cron downgrades plan when ends_at lapses.
    await orm
      .update(schema.subscriptions)
      .set({ autoRenew: false, updatedAt: sql`NOW()` })
      .where(eq(schema.subscriptions.userId, resolvedUserId))
      .catch(() => {});

  } else if (isCancelled) {
    // Hard cancellation — downgrade immediately
    await orm
      .update(schema.subscriptions)
      .set({ status: "cancelled", updatedAt: sql`NOW()` })
      .where(eq(schema.subscriptions.userId, resolvedUserId))
      .catch(() => {});

    await orm
      .update(schema.users)
      .set({ plan: "free", updatedAt: sql`NOW()` })
      .where(eq(schema.users.id, resolvedUserId))
      .catch(() => {});
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

  await insertNotification(
    orm,
    resolvedUserId,
    notifType,
    notifTitle,
    notifBody,
    { subscriptionCode: subscription_code, status, nextPaymentDate: next_payment_date }
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Helper: process a KYC Tier 1 BVN identity validation result
// ---------------------------------------------------------------------------

export async function processCustomerIdentificationEvent(
  event: PaystackCustomerIdentificationEvent
): Promise<void> {
  // Lazy import to avoid a circular dependency (lib/kyc/service.ts also
  // imports Paystack helpers from this module's sibling paystack.ts).
  const { handleBvnIdentificationResult } = await import("@/lib/kyc/service");
  const { customer_code, identification, reason } = event.data;
  const success = event.event === "customeridentification.success";

  await handleBvnIdentificationResult({
    paystackCustomerCode: customer_code,
    success,
    bvnLast4: identification?.bvn ? identification.bvn.slice(-4) : null,
    failureReason: reason ?? null,
  });
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

    case "customeridentification.success":
    case "customeridentification.failed":
      await processCustomerIdentificationEvent(payload as PaystackCustomerIdentificationEvent);
      break;

    default:
      logger.info({ eventType }, "[webhook/paystack] Ignoring unhandled event");
  }
}
