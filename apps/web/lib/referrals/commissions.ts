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
import Decimal from "decimal.js";
import { XP_VALUES } from "@/lib/xp/engine";
import { getManifestValue } from "@/lib/manifest";
import { creditCoins } from "@/lib/economy/coins";
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
 * @param db         Transaction-capable database client
 * @param buyerId    ID of the user who purchased coins
 * @param coinAmount Total coins purchased
 * @param paymentId  ID of the payment record — used to make each commission reference unique per purchase
 */
export async function awardReferralCommissions(
  db: DatabaseClient,
  buyerId: string,
  coinAmount: number,
  paymentId: string
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
  if (!tier1Id) return result;

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
    await db.query(
      `UPDATE users SET xp_total = xp_total + $1, xp_social = COALESCE(xp_social, 0) + $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
      [xpBonus, tier1Id]
    );
    await db.query(
      `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, created_at)
       VALUES ($1, $2, 'social', 'referral_qualified', $2, NOW())`,
      [tier1Id, xpBonus]
    );

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

    await db.query(
      `INSERT INTO referral_commissions
         (referrer_id, referred_user_id, trigger_event_id, tier, purchase_amount_kobo, commission_kobo, commission_coins, status, created_at)
       VALUES ($1, $2, $3, 'standard', 0, 0, $4, 'credited', NOW())
       ON CONFLICT DO NOTHING`,
      [tier1Id, buyerId, `${paymentId}:t1`, tier1Coins]
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

    await db.query(
      `INSERT INTO referral_commissions
         (referrer_id, referred_user_id, trigger_event_id, tier, purchase_amount_kobo, commission_kobo, commission_coins, status, created_at)
       VALUES ($1, $2, $3, 'standard', 0, 0, $4, 'credited', NOW())
       ON CONFLICT DO NOTHING`,
      [tier2Id, buyerId, `${paymentId}:t2`, tier2Coins]
    );
  }

  return result;
}

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
    tier: number;
    total_coins: string;
    count: string;
  }>(
    `SELECT tier, SUM(commission_coins)::text AS total_coins, COUNT(*)::text AS count
     FROM referral_commissions
     WHERE referrer_id = $1
     GROUP BY tier`,
    [referrerId]
  );

  const t1 = rows.find((r) => r.tier === 1);
  const t2 = rows.find((r) => r.tier === 2);

  return {
    totalTier1Coins: t1 ? parseInt(t1.total_coins) : 0,
    totalTier2Coins: t2 ? parseInt(t2.total_coins) : 0,
    tier1Count: t1 ? parseInt(t1.count) : 0,
    tier2Count: t2 ? parseInt(t2.count) : 0,
  };
}
