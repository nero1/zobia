/**
 * Unit tests for lib/referrals/commissions.ts
 *
 * PRD §15 + §28 — Referral commission structure:
 *   Tier 1 (direct referrer): 5% of coin purchase amount (floor)
 *   Tier 2 (referrer's referrer): 2% of coin purchase amount (floor)
 *   No Tier 3 (chain stops after 2 hops)
 *
 * lib/referrals/commissions.ts has been migrated to Drizzle ORM (the query
 * builder, driven directly off the `db: DbOrTx` param) instead of the raw
 * `@/lib/db` adapter. Rather than hand-mock every `.select()/.insert()/
 * .update()` chain shape, these tests back a *real*
 * `drizzle-orm/node-postgres` instance with a fake `pg`-shaped client whose
 * `query()` is a jest.fn, and dispatch on the compiled SQL text the same way
 * the old raw-adapter tests dispatched on `db.query`'s SQL string (see
 * lib/quests/__tests__/questEngine.test.ts and
 * lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
 *
 * `creditCoins` itself (lib/economy/coins.ts) is unit-tested separately and
 * is mocked here — these tests only need to know it was called with the
 * right recipient/amount, not re-exercise its own balance-locking/ledger
 * internals.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";

const mockQuery = jest.fn();

const fakeClient = {
  query: (queryConfig: unknown, params?: unknown[]) => {
    const text = typeof queryConfig === "string" ? queryConfig : (queryConfig as { text: string }).text;
    return mockQuery(text, params);
  },
};

const mockDb = drizzle(fakeClient as any, { schema }) as any;

const mockCreditCoins = jest.fn().mockResolvedValue({});
jest.mock("@/lib/economy/coins", () => ({
  creditCoins: (...args: unknown[]) => mockCreditCoins(...args),
}));

jest.mock("@/lib/manifest", () => ({
  getManifestValue: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/xp/safeAwardXP", () => ({
  safeAwardXP: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/payments/crypto/payouts", () => ({
  getCryptoPayoutsEnabled: jest.fn().mockResolvedValue(false),
  getCryptoPayoutMode: jest.fn().mockResolvedValue("coins"),
  creditCryptoBalance: jest.fn().mockResolvedValue(undefined),
}));

// commissions.ts imports the raw adapter (`db as globalRawDb`) for a
// getManifestValue fallback in awardMerchPhysicalReferralCommission — not
// exercised by these tests, but keep it mocked defensively.
jest.mock("@/lib/db", () => ({ db: {} }));

import { awardReferralCommissions } from "@/lib/referrals/commissions";

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

/**
 * Wires `mockQuery` to answer the two shapes of query
 * `awardReferralCommissions` issues directly through the query builder:
 *  - `SELECT referred_by FROM users WHERE id = ...` (getReferredBy)
 *  - `UPDATE referrals SET qualified = true ... RETURNING id` (first-purchase
 *    qualification) — every referral in `referralChain` is treated as
 *    not-yet-qualified, so this always returns a row.
 * Everything else (coin ledger writes, balance updates) is mocked away via
 * the `creditCoins` module mock above.
 */
function mockReferralChain(referralChain: Record<string, string | null>) {
  mockQuery.mockImplementation((text: string, params?: unknown[]) => {
    if (text.includes('select "referred_by"')) {
      const userId = params?.[0] as string;
      const referredBy = referralChain[userId] ?? null;
      return Promise.resolve({ rows: [[referredBy]], rowCount: 1 });
    }
    if (text.startsWith('update "referrals"') && text.includes("returning")) {
      return Promise.resolve({ rows: [["qualify-row-1"]], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockCreditCoins.mockClear();
});

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
    mockReferralChain(referralChain);
    const result = await awardReferralCommissions(mockDb, BUYER, 1000, "test-payment-id");
    expect(result.tier1ReferrerId).toBe(REFERRER);
    expect(result.tier1Coins).toBe(50); // floor(1000 * 0.05)
  });

  test("Tier 2 referrer receives 2% of purchase (floor) — 1000 coins → 20", async () => {
    mockReferralChain(referralChain);
    const result = await awardReferralCommissions(mockDb, BUYER, 1000, "test-payment-id");
    expect(result.tier2ReferrerId).toBe(TIER2_REFERER);
    expect(result.tier2Coins).toBe(20); // floor(1000 * 0.02)
  });

  test("Commission chain stops at Tier 2 — Tier 3 referrer receives nothing", async () => {
    mockReferralChain(referralChain);
    const result = await awardReferralCommissions(mockDb, BUYER, 1000, "test-payment-id");
    // Result only contains tier1 and tier2 — no tier3 field
    expect(result).not.toHaveProperty("tier3ReferrerId");
    expect(result).not.toHaveProperty("tier3Coins");
    // Total commissions: 50 + 20 = 70 coins; Tier 3 referrer gets 0
    expect(result.tier1Coins + result.tier2Coins).toBe(70);
    expect(mockCreditCoins.mock.calls.some((c) => c[0] === TIER3_REFERER)).toBe(false);
  });

  test("Floor rounding: 1 coin purchase → 0 coins for both tiers", async () => {
    mockReferralChain(referralChain);
    const result = await awardReferralCommissions(mockDb, BUYER, 1, "test-payment-id");
    // floor(1 * 0.05) = 0, floor(1 * 0.02) = 0
    expect(result.tier1Coins).toBe(0);
    expect(result.tier2Coins).toBe(0);
  });

  test("Floor rounding: 20 coins → Tier 1 gets 1, Tier 2 gets 0", async () => {
    mockReferralChain(referralChain);
    const result = await awardReferralCommissions(mockDb, BUYER, 20, "test-payment-id");
    // floor(20 * 0.05) = 1, floor(20 * 0.02) = 0
    expect(result.tier1Coins).toBe(1);
    expect(result.tier2Coins).toBe(0);
  });

  test("Zero coin purchase awards nothing", async () => {
    mockReferralChain(referralChain);
    const result = await awardReferralCommissions(mockDb, BUYER, 0, "test-payment-id");
    expect(result.tier1ReferrerId).toBeNull();
    expect(result.tier1Coins).toBe(0);
    expect(result.tier2ReferrerId).toBeNull();
    expect(result.tier2Coins).toBe(0);
  });

  test("No referrer → no commissions awarded", async () => {
    mockReferralChain({ [BUYER]: null });
    const result = await awardReferralCommissions(mockDb, BUYER, 1000, "test-payment-id");
    expect(result.tier1ReferrerId).toBeNull();
    expect(result.tier1Coins).toBe(0);
    expect(result.tier2ReferrerId).toBeNull();
    expect(result.tier2Coins).toBe(0);
  });

  test("Only Tier 1 referrer (no Tier 2 exists) → only Tier 1 gets commission", async () => {
    mockReferralChain({ [BUYER]: REFERRER, [REFERRER]: null });
    const result = await awardReferralCommissions(mockDb, BUYER, 1000, "test-payment-id");
    expect(result.tier1ReferrerId).toBe(REFERRER);
    expect(result.tier1Coins).toBe(50);
    expect(result.tier2ReferrerId).toBeNull();
    expect(result.tier2Coins).toBe(0);
  });

  test("Tier 2 referrer cannot be the buyer themselves (loop guard)", async () => {
    // Edge case: buyer → referrer → buyer (circular)
    mockReferralChain({ [BUYER]: REFERRER, [REFERRER]: BUYER });
    const result = await awardReferralCommissions(mockDb, BUYER, 1000, "test-payment-id");
    expect(result.tier1Coins).toBe(50);
    // The function guards against tier2Id === buyerId
    expect(result.tier2ReferrerId).toBeNull();
    expect(result.tier2Coins).toBe(0);
  });

  test("Large purchase: 50000 coins → Tier 1 = 2500, Tier 2 = 1000", async () => {
    mockReferralChain(referralChain);
    const result = await awardReferralCommissions(mockDb, BUYER, 50000, "test-payment-id");
    expect(result.tier1Coins).toBe(2500); // floor(50000 * 0.05)
    expect(result.tier2Coins).toBe(1000); // floor(50000 * 0.02)
  });
});
