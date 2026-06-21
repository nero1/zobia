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
export async function awardReferralCommissions(
  db: DatabaseClient,
  buyerId: string,
  coinAmount: number,
  paymentId: string,
  paymentAmountKobo: number = 0
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

    // Award XP
    // BUG-XP-DLQ-01 FIX: do not pass the global db adapter as dbClient — the DLQ
    // guard in safeAwardXP is `if (!dbClient)`, so passing the truthy global adapter
    // bypasses the guard and silently drops XP award failures. Omitting the argument
    // lets safeAwardXP use its internal global db and enables DLQ writes on failure.
    await safeAwardXP(tier1Id, xpBonus, 'social', 'referral_first_purchase', `referral_qualified:${qualifyRows[0].id}`);

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

  // Calculate Tier 1 commission
  const tier1Coins = new Decimal(coinAmount).mul(TIER_1_RATE).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();

  if (tier1Coins > 0) {
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

  if (tier2Coins > 0) {
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
 */
export async function retryFailedCommissions(): Promise<{ retried: number; resolved: number; permanentFailed: number }> {
  let retried = 0;
  let resolved = 0;
  let permanentFailed = 0;

  const { rows: pending } = await globalDb.query<{
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
        // DatabaseAdapter is structurally compatible with TransactionClient (both have query())
        globalDb as DatabaseClient,
        row.user_id,
        row.coin_amount,
        row.payment_id,
        row.amount_kobo
      );

      await globalDb.query(
        `UPDATE failed_commissions
         SET resolved_at = NOW(), last_retried_at = NOW(), retry_count = retry_count + 1
         WHERE id = $1`,
        [row.id]
      );
      resolved++;
    } catch (err) {
      const newCount = row.retry_count + 1;
      await globalDb.query(
        `UPDATE failed_commissions
         SET retry_count = $1, last_retried_at = NOW(), error_message = $2
         WHERE id = $3`,
        [newCount, err instanceof Error ? err.message : String(err), row.id]
      );

      if (newCount >= MAX_COMMISSION_RETRIES) {
        permanentFailed++;
        logger.error({ paymentId: row.payment_id, userId: row.user_id, newCount }, "[commissions] Commission permanently failed after max retries");
        await globalDb.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('commission_permanent_failure', 'critical', $1, $2::jsonb, NOW())`,
          [
            `Referral commission for payment ${row.payment_id} failed after ${MAX_COMMISSION_RETRIES} retries`,
            JSON.stringify({ paymentId: row.payment_id, userId: row.user_id, retryCount: newCount }),
          ]
        ).catch(() => {});
      }
    }
  }

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
