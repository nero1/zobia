/**
 * Unit tests for the hide-my-name-on-leaderboards rules
 * (lib/privacy/leaderboardAnonymity.ts): who is eligible, and how a row is
 * masked for each kind of viewer.
 */

jest.mock("@/lib/manifest", () => ({ loadManifest: jest.fn() }));

import {
  isAnonymityEligible,
  maskLeaderboardRow,
  ANONYMOUS_SNAKE_IDENTITY,
  type AnonymityConfig,
  type AnonymityUser,
} from "@/lib/privacy/leaderboardAnonymity";

const CFG: AnonymityConfig = {
  enabled: true,
  minLevel: 0,
  eligible: ["plus", "pro", "max", "business_starter", "business_growth", "business_enterprise"],
};

const user = (over: Partial<AnonymityUser> = {}): AnonymityUser => ({
  plan: "free",
  prestigeCount: 0,
  isAdmin: false,
  isModerator: false,
  businessTier: null,
  xpTotal: 0,
  ...over,
});

describe("isAnonymityEligible", () => {
  it.each(["plus", "pro", "max"])("allows the paid plan %s", (plan) => {
    expect(isAnonymityEligible(user({ plan }), CFG)).toBe(true);
  });

  it("does not allow free users", () => {
    expect(isAnonymityEligible(user(), CFG)).toBe(false);
  });

  it("allows business accounts of every tier", () => {
    for (const tier of ["starter", "growth", "enterprise"]) {
      expect(isAnonymityEligible(user({ businessTier: tier }), CFG)).toBe(true);
    }
  });

  it("is off for everyone when the admin master switch is off", () => {
    expect(isAnonymityEligible(user({ plan: "max" }), { ...CFG, enabled: false })).toBe(false);
  });

  it("unlocks free users at the admin-configured level irrespective of plan", () => {
    const cfg = { ...CFG, minLevel: 3 }; // level 3 = Hustler (6,000 XP)
    expect(isAnonymityEligible(user({ xpTotal: 5_999 }), cfg)).toBe(false);
    expect(isAnonymityEligible(user({ xpTotal: 6_000 }), cfg)).toBe(true);
  });

  it("minLevel 0 disables the level unlock", () => {
    expect(isAnonymityEligible(user({ xpTotal: 5_000_000 }), CFG)).toBe(false);
  });
});

describe("maskLeaderboardRow", () => {
  const row = { user_id: "u1", username: "alice", display_name: "Alice", avatar_emoji: "😀", xp: 10 };
  const base = { idKey: "user_id" as const, masked: ANONYMOUS_SNAKE_IDENTITY, anonId: "anon-1" };

  it("leaves visible users untouched", () => {
    expect(maskLeaderboardRow(row, { ...base, anonymous: false, isSelf: false, canReveal: false })).toBe(row);
  });

  it("shows Anonymous to a public viewer and leaks no identity", () => {
    const out = maskLeaderboardRow(row, { ...base, anonymous: true, isSelf: false, canReveal: false });
    expect(out).toMatchObject({ user_id: "anon-1", username: "anonymous", display_name: "Anonymous", anonymous: true, xp: 10 });
    expect(JSON.stringify(out)).not.toMatch(/alice|"u1"|😀/);
    expect(out.revealed).toBeUndefined();
  });

  it("lets the user see themself, flagged as hidden", () => {
    const out = maskLeaderboardRow(row, { ...base, anonymous: true, isSelf: true, canReveal: false });
    expect(out).toMatchObject({ user_id: "u1", display_name: "Alice", anonymous: true });
  });

  it("gives a sub-leaderboard admin the real identity behind `revealed`", () => {
    const out = maskLeaderboardRow(row, { ...base, anonymous: true, isSelf: false, canReveal: true });
    expect(out.display_name).toBe("Anonymous");
    expect(out.revealed).toEqual({ user_id: "u1", username: "alice", display_name: "Alice", avatar_emoji: "😀" });
  });
});
