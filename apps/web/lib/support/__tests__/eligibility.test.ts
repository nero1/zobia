/**
 * Unit tests for lib/support/eligibility.ts#getTicketEligibility.
 * The database and manifest are mocked — no real DB/Redis connection.
 */

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({
  db: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockLoadManifest = jest.fn();
jest.mock("@/lib/manifest", () => ({
  loadManifest: () => mockLoadManifest(),
}));

import { getTicketEligibility } from "@/lib/support/eligibility";

function manifestWith(eligiblePlans: string[], costCredits: number, costStars: number) {
  return {
    support: { eligiblePlans, ticketCostCredits: costCredits, ticketCostStars: costStars },
  };
}

describe("getTicketEligibility", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockLoadManifest.mockReset();
  });

  it("grants free access when the user's plan is in the allow-list", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(["plus", "pro", "max"], 50, 0));
    mockQuery.mockResolvedValue({ rows: [{ plan: "pro", prestige_count: 0 }] });

    const result = await getTicketEligibility("user-1");
    expect(result.freeAccess).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it("grants free access via a prestige_N allow-list entry even on the free plan", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(["prestige_1"], 50, 0));
    mockQuery.mockResolvedValue({ rows: [{ plan: "free", prestige_count: 2 }] });

    const result = await getTicketEligibility("user-1");
    expect(result.freeAccess).toBe(true);
  });

  it("returns a payable cost for an ineligible user when a cost is configured", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(["plus", "pro", "max"], 50, 5));
    mockQuery.mockResolvedValue({ rows: [{ plan: "free", prestige_count: 0 }] });

    const result = await getTicketEligibility("user-1");
    expect(result.freeAccess).toBe(false);
    expect(result.costCredits).toBe(50);
    expect(result.costStars).toBe(5);
    expect(result.blocked).toBe(false);
  });

  it("is blocked when ineligible and no cost is configured in either currency", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(["plus", "pro", "max"], 0, 0));
    mockQuery.mockResolvedValue({ rows: [{ plan: "free", prestige_count: 0 }] });

    const result = await getTicketEligibility("user-1");
    expect(result.freeAccess).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it("fails closed (blocked, no free access) when the user cannot be found", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(["plus", "pro", "max"], 50, 0));
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await getTicketEligibility("missing-user");
    expect(result.freeAccess).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it("fails closed on a DB error", async () => {
    mockLoadManifest.mockResolvedValue(manifestWith(["plus", "pro", "max"], 50, 0));
    mockQuery.mockRejectedValue(new Error("connection lost"));

    const result = await getTicketEligibility("user-1");
    expect(result.freeAccess).toBe(false);
    expect(result.blocked).toBe(true);
  });
});
