/**
 * Unit tests for the pure wager economics helpers.
 */

import { computeWagerPayout, requiredWins } from "@/lib/games/wager";

describe("computeWagerPayout", () => {
  it("takes the configured rake and floors the remainder", () => {
    // Pot of 200 with a 5% rake → 190.
    expect(computeWagerPayout(200, 5)).toBe(190);
  });

  it("floors fractional payouts (platform keeps the remainder)", () => {
    // 101 * 0.95 = 95.95 → 95.
    expect(computeWagerPayout(101, 5)).toBe(95);
  });

  it("returns the full pot at 0% rake", () => {
    expect(computeWagerPayout(200, 0)).toBe(200);
  });

  it("returns 0 for a non-positive pot", () => {
    expect(computeWagerPayout(0, 5)).toBe(0);
    expect(computeWagerPayout(-50, 5)).toBe(0);
  });

  it("clamps an out-of-range rake", () => {
    expect(computeWagerPayout(100, 150)).toBe(0); // clamped to 100% rake
    expect(computeWagerPayout(100, -10)).toBe(100); // clamped to 0% rake
  });
});

describe("requiredWins", () => {
  it("needs 1 win for best-of-1", () => {
    expect(requiredWins(1)).toBe(1);
  });
  it("needs 2 wins for best-of-3", () => {
    expect(requiredWins(3)).toBe(2);
  });
});
