jest.mock("@/lib/db/drizzle", () => ({ getDb: jest.fn(), schema: {} }));
jest.mock("@/lib/redis", () => ({ redis: { get: jest.fn(), setex: jest.fn(), del: jest.fn() } }));
jest.mock("@/lib/manifest", () => ({ loadManifest: jest.fn() }));
jest.mock("@/lib/logger", () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock("../repo", () => ({ getActivityCounts: jest.fn(), toPortalCard: jest.fn() }));

import { pickFeatured } from "../discover";
import type { PortalRow } from "../repo";

const NOW = Date.parse("2026-09-30T12:00:00Z");

function row(over: Partial<PortalRow> & { id: string }): PortalRow {
  return {
    slug: over.id,
    hashtagId: `h-${over.id}`,
    title: over.id,
    tagline: null,
    description: null,
    coverImageUrl: null,
    accentColor: null,
    status: "auto",
    sections: [],
    bbBoardId: null,
    city: null,
    isPinned: false,
    boostWeight: 0,
    boostStartsAt: null,
    boostEndsAt: null,
    sponsoredUntil: null,
    sponsorName: null,
    followerCount: 0,
    lastActivityAt: null,
    createdBy: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...over,
  } as PortalRow;
}

describe("pickFeatured", () => {
  it("puts pinned first, then the strongest active boost, then followers", () => {
    const rows = [
      row({ id: "plain", status: "official", followerCount: 99 }),
      row({ id: "boost50", boostWeight: 50 }),
      row({ id: "boost90", boostWeight: 90 }),
      row({ id: "pinned", isPinned: true }),
    ];
    expect(pickFeatured(rows, NOW, 8).slice(0, 3).map((r) => r.id)).toEqual(["pinned", "boost90", "boost50"]);
  });

  it("ignores expired boosts and sponsorships", () => {
    const rows = [
      row({ id: "expired", boostWeight: 100, boostEndsAt: new Date(NOW - 1000) }),
      row({ id: "oldSponsor", sponsoredUntil: new Date(NOW - 1000) }),
    ];
    expect(pickFeatured(rows, NOW)).toEqual([]);
  });

  it("tops up with officials (by followers) when fewer than 4 are promoted", () => {
    const rows = [
      row({ id: "pinned", isPinned: true }),
      row({ id: "offA", status: "official", followerCount: 5 }),
      row({ id: "offB", status: "official", followerCount: 50 }),
      row({ id: "offC", status: "official", followerCount: 10 }),
      row({ id: "autoX", followerCount: 500 }),
    ];
    expect(pickFeatured(rows, NOW).map((r) => r.id)).toEqual(["pinned", "offB", "offC", "offA"]);
  });

  it("respects the max", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ id: `p${i}`, isPinned: true }));
    expect(pickFeatured(rows, NOW, 5)).toHaveLength(5);
  });
});
