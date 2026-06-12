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
 */
export async function awardReferralCommissions(
  db: DatabaseClient,
  buyerId: string,
  coinAmount: number
): Promise<CommissionResult> {
  const result: CommissionResult = {
    tier1ReferrerId: null,
    tier1Coins: 0,
    tier2ReferrerId: null,
    tier2Coins: 0,
  };

  if (coinAmount <= 0) return result;

  // Find the direct referrer (Tier 1)
  const { rows: tier1Rows } = await db.query<{ referred_by_user_id: string | null }>(
    `SELECT referred_by_user_id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [buyerId]
  );

  const tier1Id = tier1Rows[0]?.referred_by_user_id ?? null;
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
      `UPDATE users SET xp_total = xp_total + $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
      [xpBonus, tier1Id]
    );
    await db.query(
      `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, created_at)
       VALUES ($1, $2, 'social', 'referral_qualified', $2, NOW())`,
      [tier1Id, xpBonus]
    );

    // Award one-time coin bonus
    if (coinBonus > 0) {
      const { creditCoins } = await import("@/lib/economy/coins");
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
    const { creditCoins } = await import("@/lib/economy/coins");
    await creditCoins(
      tier1Id,
      tier1Coins,
      "referral_commission",
      buyerId,
      `Tier 1 referral commission from ${coinAmount} coin purchase`,
      { tier: 1, buyerId, coinAmount },
      db
    );
    result.tier1Coins = tier1Coins;

    await db.query(
      `INSERT INTO referral_commissions
         (referrer_id, referee_id, tier, coin_amount, purchase_coin_amount, created_at)
       VALUES ($1, $2, 1, $3, $4, NOW())`,
      [tier1Id, buyerId, tier1Coins, coinAmount]
    );
  }

  // Find Tier 2 referrer (referrer of the Tier 1 referrer)
  const { rows: tier2Rows } = await db.query<{ referred_by_user_id: string | null }>(
    `SELECT referred_by_user_id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [tier1Id]
  );

  const tier2Id = tier2Rows[0]?.referred_by_user_id ?? null;
  if (!tier2Id || tier2Id === buyerId) return result;

  result.tier2ReferrerId = tier2Id;

  const tier2Coins = new Decimal(coinAmount).mul(TIER_2_RATE).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();

  if (tier2Coins > 0) {
    const { creditCoins } = await import("@/lib/economy/coins");
    await creditCoins(
      tier2Id,
      tier2Coins,
      "referral_commission",
      buyerId,
      `Tier 2 referral commission from ${coinAmount} coin purchase`,
      { tier: 2, buyerId, coinAmount },
      db
    );
    result.tier2Coins = tier2Coins;

    await db.query(
      `INSERT INTO referral_commissions
         (referrer_id, referee_id, tier, coin_amount, purchase_coin_amount, created_at)
       VALUES ($1, $2, 2, $3, $4, NOW())`,
      [tier2Id, buyerId, tier2Coins, coinAmount]
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
    `SELECT tier, SUM(coin_amount)::text AS total_coins, COUNT(*)::text AS count
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
