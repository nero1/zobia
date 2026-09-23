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

import type { TransactionClient as DatabaseClient } from "@/lib/db";
import { db as globalDb } from "@/lib/db";
import Decimal from "decimal.js";
import { XP_VALUES } from "@/lib/xp/engine";
import { getManifestValue } from "@/lib/manifest";
import { creditCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { logger } from "@/lib/logger";
import { raiseAlert } from "@/lib/alerts/dispatch";
import { getCryptoPayoutsEnabled, getCryptoPayoutMode, creditCryptoBalance } from "@/lib/payments/crypto/payouts";
import type { CryptoCurrency } from "@zobia/types";
// Schema-derived types: column name validation at compile time.
// schema.users.referredBy.name === "referred_by" — any rename triggers a TS error.
import { schema } from "@/lib/db/schema";

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
  db: DatabaseClient,
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
  // Column name validated via schema.users.referredBy.name === "referred_by".
  type ReferredByRow = { [K in typeof schema.users.referredBy.name]: string | null };
  const { rows: tier1Rows } = await db.query<ReferredByRow>(
    `SELECT referred_by FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [buyerId]
  );

  const tier1Id = tier1Rows[0]?.referred_by ?? null;
  // BUG-REFERRAL-01: also reject self-referrals (data constraint should prevent this,
  // but guard here in case the CHECK constraint was not applied on an older schema).
  if (!tier1Id || tier1Id === buyerId) return result;

  // Mark referral as qualified on first purchase and award 500 XP to referrer (PRD §referrals)
  const { rows: qualifyRows } = await db.query<{ id: string }>(
    `UPDATE referrals SET qualified = true, qualified_at = NOW()
     WHERE referred_id = $1 AND referrer_id = $2 AND qualified = false
     RETURNING id`,
    [buyerId, tier1Id]
  );
  if (qualifyRows[0]) {
    // First qualifying purchase — award one-time XP + coin bonus to referrer (PRD §15)
    const xpBonusStr = await getManifestValue("referral_tier1_xp_bonus");
    const coinBonusStr = await getManifestValue("referral_tier1_coin_bonus");

    const xpBonus = parseInt(xpBonusStr ?? "500", 10) || 500;
    const coinBonus = parseInt(coinBonusStr ?? "100", 10) || 100;

    // Award XP within the caller's transaction so it rolls back atomically if the
    // coin credit fails. When db is a TransactionClient safeAwardXP rethrows on
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
    await db.query(
      `UPDATE referrals SET coin_reward = $1, xp_reward = $2 WHERE id = $3`,
      [coinBonus, xpBonus, qualifyRows[0].id]
    );
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
    await db.query(
      `INSERT INTO referral_commissions
         (referrer_id, referred_user_id, trigger_event_id, purchase_amount_kobo, commission_kobo, commission_coins, tier, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '1', 'credited', NOW())
       ON CONFLICT (trigger_event_id) DO NOTHING`,
      [tier1Id, buyerId, `${paymentId}:t1`, paymentAmountKobo, tier1CommissionKobo, tier1Coins]
    );
  }
  // Crypto commissions are recorded in crypto_balance_ledger (referral_commissions
  // is kobo/coin-shaped and doesn't model per-token amounts) — that ledger's
  // (currency, reference_id) uniqueness gives the same idempotency + audit trail.

  // Find Tier 2 referrer (referrer of the Tier 1 referrer).
  // Same column, same schema-validated type.
  const { rows: tier2Rows } = await db.query<ReferredByRow>(
    `SELECT referred_by FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [tier1Id]
  );

  const tier2Id = tier2Rows[0]?.referred_by ?? null;
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
    await db.query(
      `INSERT INTO referral_commissions
         (referrer_id, referred_user_id, trigger_event_id, purchase_amount_kobo, commission_kobo, commission_coins, tier, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '2', 'credited', NOW())
       ON CONFLICT (trigger_event_id) DO NOTHING`,
      [tier2Id, buyerId, `${paymentId}:t2`, paymentAmountKobo, tier2CommissionKobo, tier2Coins]
    );
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
  db: DatabaseClient,
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

  type ReferredByRow = { [K in typeof schema.users.referredBy.name]: string | null };
  const { rows: tier1Rows } = await db.query<ReferredByRow>(
    `SELECT referred_by FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [buyerId]
  );
  const tier1Id = tier1Rows[0]?.referred_by ?? null;
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
    await db.query(
      `INSERT INTO referral_commissions
         (referrer_id, referred_user_id, trigger_event_id, purchase_amount_kobo, commission_kobo, commission_coins, tier, status, source_type, reference_order_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '1', 'credited', 'merch_digital', $7, NOW())
       ON CONFLICT (trigger_event_id) DO NOTHING`,
      [tier1Id, buyerId, `merch:${orderId}:t1`, priceKobo, tier1Kobo, tier1Coins, orderId]
    );
  }

  type ReferredByRow2 = ReferredByRow;
  const { rows: tier2Rows } = await db.query<ReferredByRow2>(
    `SELECT referred_by FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [tier1Id]
  );
  const tier2Id = tier2Rows[0]?.referred_by ?? null;
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
    await db.query(
      `INSERT INTO referral_commissions
         (referrer_id, referred_user_id, trigger_event_id, purchase_amount_kobo, commission_kobo, commission_coins, tier, status, source_type, reference_order_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, '2', 'credited', 'merch_digital', $7, NOW())
       ON CONFLICT (trigger_event_id) DO NOTHING`,
      [tier2Id, buyerId, `merch:${orderId}:t2`, priceKobo, tier2Kobo, tier2Coins, orderId]
    );
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
  db: DatabaseClient,
  buyerId: string,
  priceKobo: number,
  commissionPct: number,
  orderId: string
): Promise<{ referrerId: string | null; referrerCoins: number }> {
  const empty = { referrerId: null, referrerCoins: 0 };
  if (priceKobo <= 0 || commissionPct <= 0) return empty;

  type ReferredByRow = { [K in typeof schema.users.referredBy.name]: string | null };
  const { rows: buyerRows } = await db.query<ReferredByRow>(
    `SELECT referred_by FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [buyerId]
  );
  const referrerId = buyerRows[0]?.referred_by ?? null;
  if (!referrerId || referrerId === buyerId) return empty;

  const platformFeePctStr = await getManifestValue("market_referral_platform_fee_pct", db);
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
  await db.query(
    `INSERT INTO referral_commissions
       (referrer_id, referred_user_id, trigger_event_id, purchase_amount_kobo, commission_kobo, commission_coins, tier, status, source_type, reference_order_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, '1', 'credited', 'merch_physical', $7, NOW())
     ON CONFLICT (trigger_event_id) DO NOTHING`,
    [referrerId, buyerId, `merch:${orderId}:physical`, priceKobo, referrerKobo, referrerCoins, orderId]
  );

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
    await globalDb.query(
      `INSERT INTO failed_commissions
         (payment_id, user_id, coin_amount, amount_kobo, source, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (payment_id) DO NOTHING`,
      [paymentId, userId, coinAmount, amountKobo, source, errorMessage]
    );
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
 * inside a single globalDb.transaction() so the row-level lock is held for
 * the full batch-processing duration, preventing concurrent CRON instances
 * from picking up and double-processing the same rows.
 */
export async function retryFailedCommissions(): Promise<{ retried: number; resolved: number; permanentFailed: number }> {
  let retried = 0;
  let resolved = 0;
  let permanentFailed = 0;

  await globalDb.transaction(async (tx) => {
    const { rows: pending } = await tx.query<{
      id: string;
      payment_id: string;
      user_id: string;
      coin_amount: number;
      amount_kobo: number;
      source: string;
      retry_count: number;
    }>(
      `SELECT id, payment_id, user_id, coin_amount, amount_kobo, source, retry_count
       FROM failed_commissions
       WHERE resolved_at IS NULL
         AND retry_count < $1
         AND (last_retried_at IS NULL
              OR last_retried_at < NOW() - (POWER(2, retry_count) * INTERVAL '1 minute'))
       LIMIT 50
       FOR UPDATE SKIP LOCKED`,
      [MAX_COMMISSION_RETRIES]
    );

    for (const row of pending) {
      retried++;
      try {
        await awardReferralCommissions(
          tx as DatabaseClient,
          row.user_id,
          row.coin_amount,
          row.payment_id,
          row.amount_kobo
        );

        await tx.query(
          `UPDATE failed_commissions
           SET resolved_at = NOW(), last_retried_at = NOW(), retry_count = retry_count + 1
           WHERE id = $1`,
          [row.id]
        );
        resolved++;
      } catch (err) {
        const newCount = row.retry_count + 1;
        await tx.query(
          `UPDATE failed_commissions
           SET retry_count = $1, last_retried_at = NOW(), error_message = $2
           WHERE id = $3`,
          [newCount, err instanceof Error ? err.message : String(err), row.id]
        );

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
  db: DatabaseClient,
  referrerId: string
): Promise<{
  totalTier1Coins: number;
  totalTier2Coins: number;
  tier1Count: number;
  tier2Count: number;
}> {
  const { rows } = await db.query<{
    tier: string;
    total_coins: string;
    count: string;
  }>(
    `SELECT tier, SUM(commission_coins)::text AS total_coins, COUNT(*)::text AS count
     FROM referral_commissions
     WHERE referrer_id = $1
     GROUP BY tier`,
    [referrerId]
  );

  const t1 = rows.find((r) => r.tier === '1');
  const t2 = rows.find((r) => r.tier === '2');

  return {
    totalTier1Coins: t1 ? parseInt(t1.total_coins) : 0,
    totalTier2Coins: t2 ? parseInt(t2.total_coins) : 0,
    tier1Count: t1 ? parseInt(t1.count) : 0,
    tier2Count: t2 ? parseInt(t2.count) : 0,
  };
}
