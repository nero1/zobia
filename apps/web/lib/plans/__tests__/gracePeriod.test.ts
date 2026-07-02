/**
 * Unit tests for grace-period / save-slot config readers. The manifest
 * layer is mocked so no DB/Redis connection is made — these guard the
 * fallback-default behaviour when a manifest key is missing or malformed
 * (migration 0042 should keep these defaults in sync).
 */

const mockGetManifestValue = jest.fn();

jest.mock("@/lib/manifest", () => ({
  getManifestValue: (...a: unknown[]) => mockGetManifestValue(...a),
}));

import { getGracePeriodDays, getPreservedGraceFeatures, isFeaturePreservedDuringGrace } from "@/lib/plans/gracePeriod";
import { getSaveSlotLimit } from "@/lib/plans/saveSlots";

describe("getGracePeriodDays", () => {
  beforeEach(() => mockGetManifestValue.mockReset());

  it("falls back to the seeded default when the manifest key is missing", async () => {
    mockGetManifestValue.mockResolvedValueOnce(null);
    expect(await getGracePeriodDays("personal", "pro")).toBe(14);
  });

  it("uses the business-prefixed key for business tiers", async () => {
    mockGetManifestValue.mockResolvedValueOnce("21");
    expect(await getGracePeriodDays("business", "growth")).toBe(21);
    expect(mockGetManifestValue).toHaveBeenCalledWith("grace_period_days_business_growth");
  });

  it("rejects a negative or non-numeric override and falls back", async () => {
    mockGetManifestValue.mockResolvedValueOnce("-5");
    expect(await getGracePeriodDays("personal", "max")).toBe(30);
  });
});

describe("getPreservedGraceFeatures / isFeaturePreservedDuringGrace", () => {
  beforeEach(() => mockGetManifestValue.mockReset());

  it("defaults to ['saved_games'] when unset", async () => {
    mockGetManifestValue.mockResolvedValueOnce(null);
    expect(await getPreservedGraceFeatures("personal", "plus")).toEqual(["saved_games"]);
  });

  it("filters out unknown feature keys from a malicious/stale manifest value", async () => {
    mockGetManifestValue.mockResolvedValueOnce(JSON.stringify(["saved_games", "not_a_real_feature"]));
    expect(await getPreservedGraceFeatures("personal", "pro")).toEqual(["saved_games"]);
  });

  it("isFeaturePreservedDuringGrace reflects the resolved list", async () => {
    mockGetManifestValue.mockResolvedValueOnce(JSON.stringify([]));
    expect(await isFeaturePreservedDuringGrace("personal", "plus", "saved_games")).toBe(false);
  });
});

describe("getSaveSlotLimit", () => {
  beforeEach(() => mockGetManifestValue.mockReset());

  it("falls back to plan defaults when unset", async () => {
    mockGetManifestValue.mockResolvedValueOnce(null);
    expect(await getSaveSlotLimit("max")).toBe(5);
  });

  it("free plan defaults to 0 slots", async () => {
    mockGetManifestValue.mockResolvedValueOnce(null);
    expect(await getSaveSlotLimit("free")).toBe(0);
  });

  it("treats an unknown plan as free", async () => {
    mockGetManifestValue.mockResolvedValueOnce(null);
    expect(await getSaveSlotLimit("not-a-plan")).toBe(0);
  });
});
