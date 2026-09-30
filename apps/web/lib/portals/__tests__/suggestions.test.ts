jest.mock("@/lib/db/drizzle", () => ({ getDb: jest.fn(), schema: {} }));
jest.mock("@/lib/redis", () => ({ redis: { get: jest.fn(), setex: jest.fn(), del: jest.fn() } }));
jest.mock("@/lib/manifest", () => ({ loadManifest: jest.fn() }));
jest.mock("@/lib/logger", () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock("../repo", () => ({ bumpPortalImpressions: jest.fn(), getActivityCounts: jest.fn(), listFollowedPortalIds: jest.fn(), toPortalCard: jest.fn() }));

import { seededRandom, suggestionWeight, weightedSample } from "../suggestions";

const base = { status: "auto", isPinned: false, boostWeight: 0, boostActive: false, sponsored: false, activityCount: 0, followerCount: 0 };

describe("suggestionWeight", () => {
  it("is 1 for a brand new organic portal", () => {
    expect(suggestionWeight(base)).toBe(1);
  });
  it("grows with activity and followers (log scaled)", () => {
    expect(suggestionWeight({ ...base, activityCount: 100 })).toBeGreaterThan(suggestionWeight({ ...base, activityCount: 10 }));
    expect(suggestionWeight({ ...base, followerCount: 1000 })).toBeGreaterThan(suggestionWeight(base));
  });
  it("officials and pinned portals outweigh plain auto ones", () => {
    expect(suggestionWeight({ ...base, status: "official" })).toBeCloseTo(1.5);
    expect(suggestionWeight({ ...base, isPinned: true })).toBeCloseTo(2);
  });
  it("an active boost multiplies weight up to 11x; an inactive one does nothing", () => {
    expect(suggestionWeight({ ...base, boostWeight: 100, boostActive: true })).toBeCloseTo(11);
    expect(suggestionWeight({ ...base, boostWeight: 100, boostActive: false })).toBeCloseTo(1);
  });
  it("sponsorship counts as a boost of 50 and never lowers a larger boost", () => {
    expect(suggestionWeight({ ...base, sponsored: true })).toBeCloseTo(6);
    expect(suggestionWeight({ ...base, sponsored: true, boostWeight: 100, boostActive: true })).toBeCloseTo(11);
  });
});

describe("seededRandom", () => {
  it("is deterministic per seed and in [0,1)", () => {
    const a = seededRandom("u1:p1:100");
    const b = seededRandom("u1:p1:100");
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(seqA.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(seededRandom("other")()).not.toBe(seqA[0]);
  });
});

describe("weightedSample", () => {
  it("never returns duplicates or more than asked, skips zero weights", () => {
    const items = [{ id: "a", weight: 1 }, { id: "b", weight: 0 }, { id: "c", weight: 2 }];
    const out = weightedSample(items, 5, seededRandom("x"));
    expect(out.map((o) => o.id).sort()).toEqual(["a", "c"]);
  });
  it("heavily favours heavy items over many draws", () => {
    const items = [{ id: "light", weight: 1 }, { id: "heavy", weight: 50 }];
    let heavyFirst = 0;
    const rand = seededRandom("dist");
    for (let i = 0; i < 400; i++) if (weightedSample(items, 1, rand)[0].id === "heavy") heavyFirst++;
    expect(heavyFirst).toBeGreaterThan(340);
  });
  it("returns nothing for an empty pool", () => {
    expect(weightedSample([], 3, Math.random)).toEqual([]);
  });
});
