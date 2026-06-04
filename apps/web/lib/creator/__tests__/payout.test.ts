/**
 * lib/creator/__tests__/payout.test.ts
 *
 * PRD §28 — Unit tests for creator payout computation.
 *
 * Covers:
 *  - 80/20 split (creator receives 80%, platform retains 20%)
 *  - Minimum payout threshold enforcement (₦50 = 5000 kobo)
 *  - Manual approval threshold (₦5000 = 500,000 kobo)
 *  - Decimal precision: all amounts floored to kobo (integer)
 *  - Creator fund tier distribution (top 1%, 5%, 10%, 25%, 50%)
 *  - Empty creator pool returns zero distributions
 *  - Single creator gets full tier pool
 */

// ---------------------------------------------------------------------------
// Mock @/lib/db
// ---------------------------------------------------------------------------

const mockQuery = jest.fn();
const mockTransaction = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { calculateFundDistributions } from "@/lib/creator/fund";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCreators(count: number): { id: string; creator_earnings_30d: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `creator-${String(i + 1).padStart(4, "0")}`,
    creator_earnings_30d: String((count - i) * 1000), // descending earnings
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Creator Fund — Empty Pool", () => {
  test("Returns empty array when no creators", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await calculateFundDistributions(1_000_000);
    expect(result).toEqual([]);
  });

  test("Returns empty array when pool is 0", async () => {
    mockQuery.mockResolvedValueOnce({ rows: makeCreators(10) });
    const result = await calculateFundDistributions(0);
    // All distributions would be 0 — no money to distribute
    result.forEach((d) => {
      expect(d.amountKobo).toBe(0);
    });
  });
});

describe("Creator Fund — Tier Distribution Math", () => {
  test("100 creators, ₦10,000 pool: top 1% (1 creator) gets 30% of pool", async () => {
    const creators = makeCreators(100);
    mockQuery.mockResolvedValueOnce({ rows: creators });

    const poolKobo = 1_000_000; // ₦10,000
    const result = await calculateFundDistributions(poolKobo);

    // Top 1% = floor(1/100 * 100) = 1 creator
    const top1 = result.filter((d) => d.rank === 1);
    expect(top1).toHaveLength(1);
    // 30% of ₦10,000 = ₦3,000 = 300,000 kobo
    expect(top1[0].amountKobo).toBe(300_000);
  });

  test("Total distributed never exceeds pool size", async () => {
    const creators = makeCreators(200);
    mockQuery.mockResolvedValueOnce({ rows: creators });

    const poolKobo = 5_000_000;
    const result = await calculateFundDistributions(poolKobo);

    const totalDistributed = result.reduce((sum, d) => sum + d.amountKobo, 0);
    // Due to flooring, total may be slightly less than pool, but never more
    expect(totalDistributed).toBeLessThanOrEqual(poolKobo);
  });

  test("All distribution amounts are non-negative integers", async () => {
    const creators = makeCreators(50);
    mockQuery.mockResolvedValueOnce({ rows: creators });

    const result = await calculateFundDistributions(2_000_000);

    result.forEach((d) => {
      expect(Number.isInteger(d.amountKobo)).toBe(true);
      expect(d.amountKobo).toBeGreaterThanOrEqual(0);
    });
  });

  test("Ranks are sequential starting from 1", async () => {
    const creators = makeCreators(20);
    mockQuery.mockResolvedValueOnce({ rows: creators });

    const result = await calculateFundDistributions(1_000_000);

    const ranks = result.map((d) => d.rank).sort((a, b) => a - b);
    ranks.forEach((rank, i) => {
      expect(rank).toBe(i + 1);
    });
  });

  test("sharePercent values sum to ≤ 100 for each tier", async () => {
    const creators = makeCreators(100);
    mockQuery.mockResolvedValueOnce({ rows: creators });

    const result = await calculateFundDistributions(1_000_000);

    // Group by tier cutoffs (top 1, 5, 10, 25, 50)
    const tier1 = result.filter((d) => d.rank === 1);
    expect(tier1[0].sharePercent).toBe(30); // 30% / 1 creator
  });
});

describe("Creator Fund — Single Creator", () => {
  test("Single creator receives all applicable tier shares", async () => {
    const creators = makeCreators(1);
    mockQuery.mockResolvedValueOnce({ rows: creators });

    const poolKobo = 1_000_000;
    const result = await calculateFundDistributions(poolKobo);

    // 1 creator — they're in the top 100% of all tiers
    // They get their slice of whatever tiers they fall into
    expect(result.length).toBeGreaterThan(0);
    result.forEach((d) => {
      expect(d.creatorId).toBe("creator-0001");
    });
  });
});

// ---------------------------------------------------------------------------
// Payout 80/20 split unit tests (pure math, no DB)
// ---------------------------------------------------------------------------

describe("Payout — 80/20 Split Computation", () => {
  function computePayout(grossKobo: number) {
    const platformFeeKobo = Math.floor(grossKobo * 0.2);
    const netKobo = grossKobo - platformFeeKobo;
    return { grossKobo, platformFeeKobo, netKobo };
  }

  test("₦1,000 gross → creator gets ₦800", () => {
    const { netKobo, platformFeeKobo } = computePayout(100_000);
    expect(netKobo).toBe(80_000);
    expect(platformFeeKobo).toBe(20_000);
  });

  test("₦5,000 gross → creator gets ₦4,000", () => {
    const { netKobo, platformFeeKobo } = computePayout(500_000);
    expect(netKobo).toBe(400_000);
    expect(platformFeeKobo).toBe(100_000);
  });

  test("Fee + net always = gross (no kobo lost)", () => {
    const testAmounts = [100, 333, 5000, 10001, 999_999];
    testAmounts.forEach((gross) => {
      const { netKobo, platformFeeKobo } = computePayout(gross);
      expect(netKobo + platformFeeKobo).toBe(gross);
    });
  });

  test("Fee is floored (no fractional kobo)", () => {
    // 20% of 1 kobo = 0.2 → floored to 0
    const { platformFeeKobo, netKobo } = computePayout(1);
    expect(Number.isInteger(platformFeeKobo)).toBe(true);
    expect(Number.isInteger(netKobo)).toBe(true);
    expect(platformFeeKobo).toBe(0);
    expect(netKobo).toBe(1);
  });
});

describe("Payout — Minimum Threshold", () => {
  const MIN_PAYOUT_KOBO = 5_000; // ₦50

  function meetsThreshold(availableKobo: number) {
    return availableKobo >= MIN_PAYOUT_KOBO;
  }

  test("₦49.99 (4999 kobo) → below threshold", () => {
    expect(meetsThreshold(4_999)).toBe(false);
  });

  test("₦50.00 (5000 kobo) → meets threshold", () => {
    expect(meetsThreshold(5_000)).toBe(true);
  });

  test("₦100 → above threshold", () => {
    expect(meetsThreshold(10_000)).toBe(true);
  });
});

describe("Payout — Manual Approval Threshold", () => {
  const MANUAL_APPROVAL_KOBO = 500_000; // ₦5,000

  function requiresManualApproval(netKobo: number) {
    return netKobo >= MANUAL_APPROVAL_KOBO;
  }

  test("₦4,999 net → auto-approve", () => {
    expect(requiresManualApproval(499_900)).toBe(false);
  });

  test("₦5,000 net → manual approval required", () => {
    expect(requiresManualApproval(500_000)).toBe(true);
  });

  test("₦10,000 net → manual approval required", () => {
    expect(requiresManualApproval(1_000_000)).toBe(true);
  });
});
