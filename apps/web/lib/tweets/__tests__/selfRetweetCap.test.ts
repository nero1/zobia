/**
 * Unit tests for the self-retweet cap rule (lib/tweets/selfRetweetCap.ts).
 */

import { computeSelfRetweetCap, canUpgradeSelfRetweetCap } from "../selfRetweetCap";

const cfg = {
  selfRetweetLevelCaps: { "1": 2, "5": 5 },
  selfRetweetPlanCaps: { plus: 3, pro: 5, max: 10, business_starter: 10, business_growth: 15, business_enterprise: 30 },
};

const free = (rankNumber: number) => ({ plan: "free", rankNumber, businessTier: null });

describe("computeSelfRetweetCap", () => {
  it("gives non-paid accounts the highest level tier reached", () => {
    expect(computeSelfRetweetCap(free(1), cfg)).toBe(2);
    expect(computeSelfRetweetCap(free(4), cfg)).toBe(2);
    expect(computeSelfRetweetCap(free(5), cfg)).toBe(5);
    expect(computeSelfRetweetCap({ plan: null, rankNumber: 40, businessTier: null }, cfg)).toBe(5);
  });

  it("falls back to 1 when there are no level tiers or the level is below every tier", () => {
    expect(computeSelfRetweetCap(free(50), { ...cfg, selfRetweetLevelCaps: {} })).toBe(1);
    expect(computeSelfRetweetCap(free(1), { ...cfg, selfRetweetLevelCaps: { "3": 4 } })).toBe(1);
  });

  it("raises the cap with the plan", () => {
    const caps = ["plus", "pro", "max"].map((plan) => computeSelfRetweetCap({ plan, rankNumber: 1, businessTier: null }, cfg));
    expect(caps).toEqual([3, 5, 10]);
  });

  it("uses the business tier cap and takes the highest of everything that applies", () => {
    expect(computeSelfRetweetCap({ plan: "free", rankNumber: 1, businessTier: "starter" }, cfg)).toBe(10);
    expect(computeSelfRetweetCap({ plan: "free", rankNumber: 1, businessTier: "growth" }, cfg)).toBe(15);
    expect(computeSelfRetweetCap({ plan: "plus", rankNumber: 1, businessTier: "Enterprise" }, cfg)).toBe(30);
    expect(computeSelfRetweetCap({ plan: "plus", rankNumber: 50, businessTier: null }, cfg)).toBe(5);
  });

  it("never returns less than 1, even for a plan missing from the map", () => {
    expect(computeSelfRetweetCap({ plan: "pro", rankNumber: 1, businessTier: null }, { selfRetweetLevelCaps: {}, selfRetweetPlanCaps: {} })).toBe(1);
  });
});

describe("canUpgradeSelfRetweetCap", () => {
  it("is true while some plan offers more, false at the top", () => {
    expect(canUpgradeSelfRetweetCap(2, cfg)).toBe(true);
    expect(canUpgradeSelfRetweetCap(29, cfg)).toBe(true);
    expect(canUpgradeSelfRetweetCap(30, cfg)).toBe(false);
  });
});
