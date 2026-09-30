/**
 * Unit tests for the self-retweet cap rule (lib/tweets/selfRetweetCap.ts).
 */

import { computeSelfRetweetCap } from "../selfRetweetCap";

const cfg = {
  selfRetweetLevelMin: 10,
  selfRetweetLevelMax: 2,
  selfRetweetPlanCaps: { plus: 3, pro: 5, max: 10, business_starter: 5, business_growth: 10, business_enterprise: 20 },
};

describe("computeSelfRetweetCap", () => {
  it("gives a non-paid account below the unlock level a cap of 1", () => {
    expect(computeSelfRetweetCap({ plan: "free", rankNumber: 9, businessTier: null }, cfg)).toBe(1);
  });

  it("gives a non-paid account at/above the unlock level the fixed level cap", () => {
    expect(computeSelfRetweetCap({ plan: "free", rankNumber: 10, businessTier: null }, cfg)).toBe(2);
    expect(computeSelfRetweetCap({ plan: null, rankNumber: 40, businessTier: null }, cfg)).toBe(2);
  });

  it("disables the level unlock when the unlock level is 0", () => {
    expect(computeSelfRetweetCap({ plan: "free", rankNumber: 99, businessTier: null }, { ...cfg, selfRetweetLevelMin: 0 })).toBe(1);
  });

  it("raises the cap with the plan", () => {
    const caps = ["plus", "pro", "max"].map((plan) => computeSelfRetweetCap({ plan, rankNumber: 1, businessTier: null }, cfg));
    expect(caps).toEqual([3, 5, 10]);
  });

  it("uses the business tier cap and takes the highest of everything that applies", () => {
    expect(computeSelfRetweetCap({ plan: "free", rankNumber: 1, businessTier: "growth" }, cfg)).toBe(10);
    expect(computeSelfRetweetCap({ plan: "plus", rankNumber: 1, businessTier: "Enterprise" }, cfg)).toBe(20);
    expect(computeSelfRetweetCap({ plan: "plus", rankNumber: 50, businessTier: null }, { ...cfg, selfRetweetLevelMax: 7 })).toBe(7);
  });

  it("never returns less than 1, even for a plan missing from the map", () => {
    expect(computeSelfRetweetCap({ plan: "pro", rankNumber: 1, businessTier: null }, { ...cfg, selfRetweetPlanCaps: {} })).toBe(1);
  });
});
