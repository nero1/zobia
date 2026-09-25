/**
 * lib/referrals/commissions.ts
 *
 * Commission-based referral affiliate system.
 *
 * Commission structure (PRD §referrals):
 *  - Tier 1 (direct referral): 5% of every coin purchase the referred user makes
 *  - Tier 2 (indirect referral): 2% of coin purchases by users referred by your direct referrals
 *
 * Commissions are credited as Coins to the referrer's wallet.
 * All operations are atomic within a DB transaction.
 */

import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { XP_VALUES } from "@/lib/xp/engine";
import { getManifestValue } from "@/lib/manifest";
import { db as globalRawDb } from "@/lib/db";
import { creditCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { logger } from "@/lib/logger";
import { raiseAlert } from "@/lib/alerts/dispatch";
import { getCryptoPayoutsEnabled, getCryptoPayoutMode, creditCryptoBalance } from "@/lib/payments/crypto/payouts";
import type { CryptoCurrency } from "@zobia/types";
// Schema-derived types: column name validation at compile time.
// schema.users.referredBy.name === "referred_by" — any rename triggers a TS error.
import { schema } from "@/lib/db/schema";
import { getDb, type DbOrTx } from "@/lib/db/drizzle";
// `failedCommissions` is not included in the aggregate `schema` object
// exported from lib/db/schema.ts (schema/DB mismatch — reported upstream),
// even though the table itself is defined and exported there — imported
// directly to work around that gap.
import { failedCommissions } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Commission rates
// ---------------------------------------------------------------------------

const TIER_1_RATE = new Decimal("0.05"); // 5%
const TIER_2_RATE = new Decimal("0.02"); // 2%

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommissionResult {
  tier1ReferrerId: string | null;
  tier1Coins: number;
  tier2ReferrerId: string | null;
  tier2Coins: number;
}

async function getReferredBy(db: DbOrTx, userId: string): Promise<string | null> {
  // Column name validated via schema.users.referredBy.name === "referred_by".
  const rows = await db
    .select({ referredBy: schema.users.referredBy })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
    .limit(1);
  return rows[0]?.referredBy ?? null;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Award referral commissions when a user completes a coin purchase.
 *
 * Called inside the payment webhook handler after a successful payment.
 * Must be passed a transaction client to ensure atomicity.
 *
 * @param db                 Transaction-capable database client
 * @param buyerId            ID of the user who purchased coins
 * @param coinAmount         Total coins purchased
 * @param paymentId          ID of the payment record — used to make each commission reference unique per purchase
 * @param paymentAmountKobo  Actual payment amount in kobo (smallest currency unit) for monetary audit records
 */
export interface CryptoPurchaseContext {
  currency: string;
  chain: string;
  /** Total base-unit amount the buyer paid, in `currency` — the referrer's
   *  commission is the same tier percentage of this, in the same currency. */
  expectedBaseUnits: string;
}

export async function awardReferralCommissions(
  db: DbOrTx,
  buyerId: string,
  coinAmount: number,
  paymentId: string,
  paymentAmountKobo: number = 0,
  cryptoContext: CryptoPurchaseContext | null = null
): Promise<CommissionResult> {
  const result: CommissionResult = {
    tier1ReferrerId: null,
    tier1Coins: 0,
    tier2ReferrerId: null,
    tier2Coins: 0,
  };

  if (coinAmount <= 0) return result;

  // Find the direct referrer (Tier 1).
  const tier1Id = await getReferredBy(db, buyerId);
  // BUG-REFERRAL-01: also reject self-referrals (data constraint should prevent this,
  // but guard here in case the CHECK constraint was not applied on an older schema).
  if (!tier1Id || tier1Id === buyerId) return result;

  // Mark referral as qualified on first purchase and award 500 XP to referrer (PRD §referrals)
  const qualifyRows = await db
    .update(schema.referrals)
    .set({ qualified: true, qualifiedAt: sql`NOW()` })
    .where(and(eq(schema.referrals.referredId, buyerId), eq(schema.referrals.referrerId, tier1Id), eq(schema.referrals.qualified, false)))
    .returning({ id: schema.referrals.id });
  if (qualifyRows[0]) {
    // First qualifying purchase — award one-time XP + coin bonus to referrer (PRD §15)
    const xpBonusStr = await getManifestValue("referral_tier1_xp_bonus");
    const coinBonusStr = await getManifestValue("referral_tier1_coin_bonus");

    const xpBonus = parseInt(xpBonusStr ?? "500", 10) || 500;
    const coinBonus = parseInt(coinBonusStr ?? "100", 10) || 100;

    // Award XP within the caller's transaction so it rolls back atomically if the
    // coin credit fails. When db is a transaction client, safeAwardXP rethrows on
    // failure (no phantom DLQ entry) — the caller must handle/retry the error.
    await safeAwardXP(tier1Id, xpBonus, 'social', 'referral_first_purchase', `referral_qualified:${qualifyRows[0].id}`, db);

    // Award one-time coin bonus
    if (coinBonus > 0) {
      await creditCoins(
        tier1Id,
        coinBonus,
        "referral_bonus",
        qualifyRows[0].id,
        "One-time referral bonus for referring a new user",
        {},
        db
      );
    }

    // Update referrals table with reward amounts
    await db
      .update(schema.referrals)
      .set({ coinReward: coinBonus, xpReward: xpBonus })
      .where(eq(schema.referrals.id, qualifyRows[0].id));
  }

  result.tier1ReferrerId = tier1Id;

  // Crypto-sourced purchases pay commission in the same crypto currency
  // (never merged into NGN/Credits accounting) when the admin has enabled
  // crypto payouts in "crypto" mode. Otherwise — including while crypto
  // payouts are disabled entirely — commission is credited as Coins exactly
  // as before this feature existed.
  const payCryptoNative =
    cryptoContext !== null && (await getCryptoPayoutsEnabled()) && (await getCryptoPayoutMode()) === "crypto";

  // Calculate Tier 1 commission
  const tier1Coins = new Decimal(coinAmount).mul(TIER_1_RATE).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();

  if (payCryptoNative && cryptoContext) {
    const tier1Crypto = BigInt(
      new Decimal(cryptoContext.expectedBaseUnits).mul(TIER_1_RATE).toFixed(0, Decimal.ROUND_DOWN)
    );
    await creditCryptoBalance(
      db,
      tier1Id,
      cryptoContext.currency as CryptoCurrency,
      tier1Crypto,
      "referral_commission",
      `referral:${paymentId}:t1`,
      { tier: 1, buyerId, chain: cryptoContext.chain }
    );
  } else if (tier1Coins > 0) {
    await creditCoins(
      tier1Id,
      tier1Coins,
      "referral_commission",
      `referral:${paymentId}:t1`,
      `Tier 1 referral commission from ${coinAmount} coin purchase`,
      { tier: 1, buyerId, coinAmount },
      db
    );
    result.tier1Coins = tier1Coins;

    const tier1CommissionKobo = paymentAmountKobo > 0
      ? Math.round(paymentAmountKobo * Number(TIER_1_RATE))
      : 0;
    await db
      .insert(schema.referralCommissions)
      .values({
        referrerId: tier1Id,
        referredUserId: buyerId,
        triggerEventId: `${paymentId}:t1`,
        purchaseAmountKobo: BigInt(paymentAmountKobo),
        commissionKobo: BigInt(tier1CommissionKobo),
        commissionCoins: BigInt(tier1Coins),
        tier: 1,
        status: "credited",
      })
      .onConflictDoNothing({ target: schema.referralCommissions.triggerEventId });
  }
  // Crypto commissions are recorded in crypto_balance_ledger (referral_commissions
  // is kobo/coin-shaped and doesn't model per-token amounts) — that ledger's
  // (currency, reference_id) uniqueness gives the same idempotency + audit trail.

  // Find Tier 2 referrer (referrer of the Tier 1 referrer).
  const tier2Id = await getReferredBy(db, tier1Id);
  if (!tier2Id || tier2Id === buyerId || tier2Id === tier1Id) return result;

  result.tier2ReferrerId = tier2Id;

  const tier2Coins = new Decimal(coinAmount).mul(TIER_2_RATE).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();

  if (payCryptoNative && cryptoContext) {
    const tier2Crypto = BigInt(
      new Decimal(cryptoContext.expectedBaseUnits).mul(TIER_2_RATE).toFixed(0, Decimal.ROUND_DOWN)
    );
    await creditCryptoBalance(
      db,
      tier2Id,
      cryptoContext.currency as CryptoCurrency,
      tier2Crypto,
      "referral_commission",
      `referral:${paymentId}:t2`,
      { tier: 2, buyerId, chain: cryptoContext.chain }
    );
  } else if (tier2Coins > 0) {
    await creditCoins(
      tier2Id,
      tier2Coins,
      "referral_commission",
      `referral:${paymentId}:t2`,
      `Tier 2 referral commission from ${coinAmount} coin purchase`,
      { tier: 2, buyerId, coinAmount },
      db
    );
    result.tier2Coins = tier2Coins;

    const tier2CommissionKobo = paymentAmountKobo > 0
      ? Math.round(paymentAmountKobo * Number(TIER_2_RATE))
      : 0;
    await db
      .insert(schema.referralCommissions)
      .values({
        referrerId: tier2Id,
        referredUserId: buyerId,
        triggerEventId: `${paymentId}:t2`,
        purchaseAmountKobo: BigInt(paymentAmountKobo),
        commissionKobo: BigInt(tier2CommissionKobo),
        commissionCoins: BigInt(tier2Coins),
        tier: 2,
        status: "credited",
      })
      .onConflictDoNothing({ target: schema.referralCommissions.triggerEventId });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Market (creator item) referral commissions
// ---------------------------------------------------------------------------

/** kobo -> coins, matching the ceil convention used at merch checkout (app/api/merch/purchase/route.ts). */
function koboToCoinsFloor(kobo: number): number {
  return Math.floor(kobo / 100);
}

/**
 * Award a referral commission for a DIGITAL Market item purchase.
 *
 * Reuses the platform's standard tier1/tier2 rates (5% / 2%) applied to the
 * item price — same mechanism as `awardReferralCommissions` for coin
 * purchases, just a different trigger event and a distinct
 * `source_type`/`reference_order_id` on the ledger row so it's
 * distinguishable in a referrer's stats.
 *
 * Gated by the caller on `market_referral_digital_enabled` (x_manifest) and
 * the product's own `referral_enabled` flag — this function itself performs
 * no gating, it only pays out.
 */
export async function awardMerchDigitalReferralCommission(
  db: DbOrTx,
  buyerId: string,
  priceKobo: number,
  orderId: string
): Promise<CommissionResult> {
  const result: CommissionResult = {
    tier1ReferrerId: null,
    tier1Coins: 0,
    tier2ReferrerId: null,
    tier2Coins: 0,
  };
  if (priceKobo <= 0) return result;

  const tier1Id = await getReferredBy(db, buyerId);
  if (!tier1Id || tier1Id === buyerId) return result;
  result.tier1ReferrerId = tier1Id;

  const tier1Kobo = new Decimal(priceKobo).mul(TIER_1_RATE).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
  const tier1Coins = koboToCoinsFloor(tier1Kobo);
  if (tier1Coins > 0) {
    await creditCoins(
      tier1Id,
      tier1Coins,
      "referral_commission",
      `merch:${orderId}:t1`,
      `Tier 1 referral commission from a Market item purchase`,
      { tier: 1, buyerId, orderId },
      db
    );
    result.tier1Coins = tier1Coins;
    await db
      .insert(schema.referralCommissions)
      .values({
        referrerId: tier1Id,
        referredUserId: buyerId,
        triggerEventId: `merch:${orderId}:t1`,
        purchaseAmountKobo: BigInt(priceKobo),
        commissionKobo: BigInt(tier1Kobo),
        commissionCoins: BigInt(tier1Coins),
        tier: 1,
        status: "credited",
        sourceType: "merch_digital",
        referenceOrderId: orderId,
      })
      .onConflictDoNothing({ target: schema.referralCommissions.triggerEventId });
  }

  const tier2Id = await getReferredBy(db, tier1Id);
  if (!tier2Id || tier2Id === buyerId || tier2Id === tier1Id) return result;
  result.tier2ReferrerId = tier2Id;

  const tier2Kobo = new Decimal(priceKobo).mul(TIER_2_RATE).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
  const tier2Coins = koboToCoinsFloor(tier2Kobo);
  if (tier2Coins > 0) {
    await creditCoins(
      tier2Id,
      tier2Coins,
      "referral_commission",
      `merch:${orderId}:t2`,
      `Tier 2 referral commission from a Market item purchase`,
      { tier: 2, buyerId, orderId },
      db
    );
    result.tier2Coins = tier2Coins;
    await db
      .insert(schema.referralCommissions)
      .values({
        referrerId: tier2Id,
        referredUserId: buyerId,
        triggerEventId: `merch:${orderId}:t2`,
        purchaseAmountKobo: BigInt(priceKobo),
        commissionKobo: BigInt(tier2Kobo),
        commissionCoins: BigInt(tier2Coins),
        tier: 2,
        status: "credited",
        sourceType: "merch_digital",
        referenceOrderId: orderId,
      })
      .onConflictDoNothing({ target: schema.referralCommissions.triggerEventId });
  }

  return result;
}

/**
 * Award a referral commission for a PHYSICAL Market item purchase.
 *
 * Physical items don't use the standard tier1/tier2 rates: the seller
 * decides the *pool* (a % of the item price, minimum enforced by
 * `market_referral_physical_min_pct`), because — unlike a digital item or a
 * coin top-up — the full sale price of a physical good is not profit
 * (materials/shipping). The platform then takes its standard cut
 * (`market_referral_platform_fee_pct`, same rate as the merch 80/20 split)
 * out of that pool, and the remainder goes to the *direct* referrer only
 * (single-tier — the pool is already small).
 *
 * Called once an order is confirmed received (not at purchase time), since a
 * physical order can still be refunded/disputed before then.
 */
export async function awardMerchPhysicalReferralCommission(
  db: DbOrTx,
  buyerId: string,
  priceKobo: number,
  commissionPct: number,
  orderId: string
): Promise<{ referrerId: string | null; referrerCoins: number }> {
  const empty = { referrerId: null, referrerCoins: 0 };
  if (priceKobo <= 0 || commissionPct <= 0) return empty;

  const referrerId = await getReferredBy(db, buyerId);
  if (!referrerId || referrerId === buyerId) return empty;

  // getManifestValue hasn't been migrated off the raw adapter type yet; its
  // DB fallback (cache-miss only) always uses the shared raw `db` connection
  // here rather than the caller's Drizzle tx, since Drizzle's DbOrTx doesn't
  // implement the raw adapter's .query() interface it expects.
  const platformFeePctStr = await getManifestValue("market_referral_platform_fee_pct", globalRawDb);
  const platformFeePct = platformFeePctStr ? parseFloat(platformFeePctStr) : 20;

  const poolKobo = new Decimal(priceKobo).mul(commissionPct).div(100).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const platformCutKobo = poolKobo.mul(platformFeePct).div(100).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const referrerKobo = poolKobo.minus(platformCutKobo).toNumber();
  const referrerCoins = koboToCoinsFloor(referrerKobo);
  if (referrerCoins <= 0) return empty;

  await creditCoins(
    referrerId,
    referrerCoins,
    "referral_commission",
    `merch:${orderId}:physical`,
    `Referral commission from a physical Market item purchase`,
    { buyerId, orderId, commissionPct, platformFeePct },
    db
  );
  await db
    .insert(schema.referralCommissions)
    .values({
      referrerId,
      referredUserId: buyerId,
      triggerEventId: `merch:${orderId}:physical`,
      purchaseAmountKobo: BigInt(priceKobo),
      commissionKobo: BigInt(referrerKobo),
      commissionCoins: BigInt(referrerCoins),
      tier: 1,
      status: "credited",
      sourceType: "merch_physical",
      referenceOrderId: orderId,
    })
    .onConflictDoNothing({ target: schema.referralCommissions.triggerEventId });

  return { referrerId, referrerCoins };
}

// ---------------------------------------------------------------------------
// DLQ: write failed commission attempts
// ---------------------------------------------------------------------------

/**
 * Write a failed referral commission to the DLQ table so it can be retried
 * by the CRON job at /api/cron/retry-commissions.
 */
export async function recordFailedCommission(
  paymentId: string,
  userId: string,
  coinAmount: number,
  amountKobo: number,
  source: string,
  errorMessage: string
): Promise<void> {
  try {
    const orm = await getDb();
    await orm
      .insert(failedCommissions)
      .values({
        paymentId,
        userId,
        coinAmount: BigInt(coinAmount),
        amountKobo: BigInt(amountKobo),
        source,
        errorMessage,
      })
      .onConflictDoNothing({ target: failedCommissions.paymentId });
  } catch (err) {
    logger.error({ err, paymentId, userId }, "[commissions] Failed to write commission to DLQ");
  }
}

const MAX_COMMISSION_RETRIES = 5;

/**
 * Retry failed referral commissions from the DLQ.
 * Designed to be called from a CRON route. Uses FOR UPDATE SKIP LOCKED so
 * concurrent CRON instances process disjoint sets of rows.
 *
 * BUG-001 FIX: wrap the SELECT … FOR UPDATE SKIP LOCKED and all processing
 * inside a single transaction so the row-level lock is held for the full
 * batch-processing duration, preventing concurrent CRON instances from
 * picking up and double-processing the same rows.
 */
export async function retryFailedCommissions(): Promise<{ retried: number; resolved: number; permanentFailed: number }> {
  let retried = 0;
  let resolved = 0;
  let permanentFailed = 0;

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const pending = await tx.execute<{
      id: string;
      payment_id: string;
      user_id: string;
      coin_amount: number;
      amount_kobo: number;
      source: string;
      retry_count: number;
    }>(sql`
      SELECT id, payment_id, user_id, coin_amount, amount_kobo, source, retry_count
      FROM failed_commissions
      WHERE resolved_at IS NULL
        AND retry_count < ${MAX_COMMISSION_RETRIES}
        AND (last_retried_at IS NULL
             OR last_retried_at < NOW() - (POWER(2, retry_count) * INTERVAL '1 minute'))
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);

    for (const row of pending.rows) {
      retried++;
      try {
        await awardReferralCommissions(
          tx,
          row.user_id,
          row.coin_amount,
          row.payment_id,
          row.amount_kobo
        );

        await tx.execute(sql`
          UPDATE failed_commissions
          SET resolved_at = NOW(), last_retried_at = NOW(), retry_count = retry_count + 1
          WHERE id = ${row.id}
        `);
        resolved++;
      } catch (err) {
        const newCount = row.retry_count + 1;
        await tx.execute(sql`
          UPDATE failed_commissions
          SET retry_count = ${newCount}, last_retried_at = NOW(), error_message = ${err instanceof Error ? err.message : String(err)}
          WHERE id = ${row.id}
        `);

        if (newCount >= MAX_COMMISSION_RETRIES) {
          permanentFailed++;
          logger.error({ paymentId: row.payment_id, userId: row.user_id, newCount }, "[commissions] Commission permanently failed after max retries");
          await raiseAlert(tx, {
            type: "commission_permanent_failure",
            category: "financial",
            priorityLevel: 2,
            title: "Referral commission permanently failed",
            message: `Referral commission for payment ${row.payment_id} failed after ${MAX_COMMISSION_RETRIES} retries`,
            metadata: { paymentId: row.payment_id, userId: row.user_id, retryCount: newCount },
            dedupeKey: `commission_permanent_failure:${row.payment_id}`,
          }).catch(() => {});
        }
      }
    }
  });

  return { retried, resolved, permanentFailed };
}

// ---------------------------------------------------------------------------
// Commission stats
// ---------------------------------------------------------------------------

/**
 * Get commission stats for a referrer.
 */
export async function getCommissionStats(
  referrerId: string
): Promise<{
  totalTier1Coins: number;
  totalTier2Coins: number;
  tier1Count: number;
  tier2Count: number;
}> {
  const orm = await getDb();
  const rows = await orm
    .select({
      tier: schema.referralCommissions.tier,
      totalCoins: sql<string>`SUM(${schema.referralCommissions.commissionCoins})::text`,
      count: sql<string>`COUNT(*)::text`,
    })
    .from(schema.referralCommissions)
    .where(eq(schema.referralCommissions.referrerId, referrerId))
    .groupBy(schema.referralCommissions.tier);

  // NOTE: `referral_commissions.tier` is `integer` (schema.ts), not text, and
  // the raw-SQL version's `SELECT tier` never cast it to text either — so
  // `r.tier` was always a JS number there too, meaning the original
  // `r.tier === '1'` string comparison always evaluated false (a
  // pre-existing bug: this function always returned all-zero commission
  // stats). Drizzle's stricter typing surfaced this at compile time; fixed
  // to compare against the actual numeric tier values rather than silently
  // reproducing the dead comparison — flagging this as an intentional
  // behavior change (a bug fix) in the migration report.
  const t1 = rows.find((r) => r.tier === 1);
  const t2 = rows.find((r) => r.tier === 2);

  return {
    totalTier1Coins: t1 ? parseInt(t1.totalCoins) : 0,
    totalTier2Coins: t2 ? parseInt(t2.totalCoins) : 0,
    tier1Count: t1 ? parseInt(t1.count) : 0,
    tier2Count: t2 ? parseInt(t2.count) : 0,
  };
}
