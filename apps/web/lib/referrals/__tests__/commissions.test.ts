/**
 * Unit tests for lib/referrals/commissions.ts
 *
 * PRD §15 + §28 — Referral commission structure:
 *   Tier 1 (direct referrer): 5% of coin purchase amount (floor)
 *   Tier 2 (referrer's referrer): 2% of coin purchase amount (floor)
 *   No Tier 3 (chain stops after 2 hops)
 */

import { awardReferralCommissions } from "../commissions";
import type { TransactionClient as DatabaseClient } from "@/lib/db";

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

function buildMockDb(referralChain: Record<string, string | null>): DatabaseClient {
  const ledger: Array<{ user_id: string; amount: number; type: string }> = [];
  const balances: Record<string, number> = {};

  // Seed starting balances
  for (const userId of Object.keys(referralChain)) {
    balances[userId] = 1000;
  }

  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      // SELECT referred_by FROM users WHERE id = $1
      if (sql.includes("SELECT referred_by")) {
        const userId = (params as string[])[0];
        const referredBy = referralChain[userId] ?? null;
        return { rows: [{ referred_by: referredBy }], rowCount: 1 };
      }

      // UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2 RETURNING coin_balance
      if (sql.includes("UPDATE users SET coin_balance")) {
        const amount = (params as [number, string])[0];
        const userId = (params as [number, string])[1];
        balances[userId] = (balances[userId] ?? 0) + amount;
        return { rows: [{ coin_balance: balances[userId] }], rowCount: 1 };
      }

      // INSERT INTO coin_ledger
      if (sql.includes("INSERT INTO coin_ledger")) {
        const [userId, amount, , , , type] = params as [string, number, number, number, string, string];
        ledger.push({ user_id: userId, amount, type });
        return { rows: [], rowCount: 1 };
      }

      // INSERT INTO referral_commissions
      if (sql.includes("INSERT INTO referral_commissions")) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }),
  } as unknown as DatabaseClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("awardReferralCommissions — PRD §15", () => {
  const REFERRER      = "user-referrer-001";
  const TIER2_REFERER = "user-referrer-002";
  const TIER3_REFERER = "user-referrer-003";
  const BUYER         = "user-buyer-001";

  const referralChain: Record<string, string | null> = {
    [BUYER]:         REFERRER,
    [REFERRER]:      TIER2_REFERER,
    [TIER2_REFERER]: TIER3_REFERER, // Would be Tier 3 — must NOT receive coins
    [TIER3_REFERER]: null,
  };

  test("Tier 1 referrer receives 5% of purchase (floor) — 1000 coins → 50", async () => {
    const db = buildMockDb(referralChain);
    const result = await awardReferralCommissions(db, BUYER, 1000, "test-payment-id");
    expect(result.tier1ReferrerId).toBe(REFERRER);
    expect(result.tier1Coins).toBe(50); // floor(1000 * 0.05)
  });

  test("Tier 2 referrer receives 2% of purchase (floor) — 1000 coins → 20", async () => {
    const db = buildMockDb(referralChain);
    const result = await awardReferralCommissions(db, BUYER, 1000, "test-payment-id");
    expect(result.tier2ReferrerId).toBe(TIER2_REFERER);
    expect(result.tier2Coins).toBe(20); // floor(1000 * 0.02)
  });

  test("Commission chain stops at Tier 2 — Tier 3 referrer receives nothing", async () => {
    const db = buildMockDb(referralChain);
    const result = await awardReferralCommissions(db, BUYER, 1000, "test-payment-id");
    // Result only contains tier1 and tier2 — no tier3 field
    expect(result).not.toHaveProperty("tier3ReferrerId");
    expect(result).not.toHaveProperty("tier3Coins");
    // Total commissions: 50 + 20 = 70 coins; Tier 3 referrer gets 0
    expect(result.tier1Coins + result.tier2Coins).toBe(70);
  });

  test("Floor rounding: 1 coin purchase → 0 coins for both tiers", async () => {
    const db = buildMockDb(referralChain);
    const result = await awardReferralCommissions(db, BUYER, 1, "test-payment-id");
    // floor(1 * 0.05) = 0, floor(1 * 0.02) = 0
    expect(result.tier1Coins).toBe(0);
    expect(result.tier2Coins).toBe(0);
  });

  test("Floor rounding: 20 coins → Tier 1 gets 1, Tier 2 gets 0", async () => {
    const db = buildMockDb(referralChain);
    const result = await awardReferralCommissions(db, BUYER, 20, "test-payment-id");
    // floor(20 * 0.05) = 1, floor(20 * 0.02) = 0
    expect(result.tier1Coins).toBe(1);
    expect(result.tier2Coins).toBe(0);
  });

  test("Zero coin purchase awards nothing", async () => {
    const db = buildMockDb(referralChain);
    const result = await awardReferralCommissions(db, BUYER, 0, "test-payment-id");
    expect(result.tier1ReferrerId).toBeNull();
    expect(result.tier1Coins).toBe(0);
    expect(result.tier2ReferrerId).toBeNull();
    expect(result.tier2Coins).toBe(0);
  });

  test("No referrer → no commissions awarded", async () => {
    const db = buildMockDb({ [BUYER]: null });
    const result = await awardReferralCommissions(db, BUYER, 1000, "test-payment-id");
    expect(result.tier1ReferrerId).toBeNull();
    expect(result.tier1Coins).toBe(0);
    expect(result.tier2ReferrerId).toBeNull();
    expect(result.tier2Coins).toBe(0);
  });

  test("Only Tier 1 referrer (no Tier 2 exists) → only Tier 1 gets commission", async () => {
    const db = buildMockDb({ [BUYER]: REFERRER, [REFERRER]: null });
    const result = await awardReferralCommissions(db, BUYER, 1000, "test-payment-id");
    expect(result.tier1ReferrerId).toBe(REFERRER);
    expect(result.tier1Coins).toBe(50);
    expect(result.tier2ReferrerId).toBeNull();
    expect(result.tier2Coins).toBe(0);
  });

  test("Tier 2 referrer cannot be the buyer themselves (loop guard)", async () => {
    // Edge case: buyer → referrer → buyer (circular)
    const db = buildMockDb({ [BUYER]: REFERRER, [REFERRER]: BUYER });
    const result = await awardReferralCommissions(db, BUYER, 1000, "test-payment-id");
    expect(result.tier1Coins).toBe(50);
    // The function guards against tier2Id === buyerId
    expect(result.tier2ReferrerId).toBeNull();
    expect(result.tier2Coins).toBe(0);
  });

  test("Large purchase: 50000 coins → Tier 1 = 2500, Tier 2 = 1000", async () => {
    const db = buildMockDb(referralChain);
    const result = await awardReferralCommissions(db, BUYER, 50000, "test-payment-id");
    expect(result.tier1Coins).toBe(2500); // floor(50000 * 0.05)
    expect(result.tier2Coins).toBe(1000); // floor(50000 * 0.02)
  });
});
