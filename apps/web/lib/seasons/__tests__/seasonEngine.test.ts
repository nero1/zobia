/**
 * Unit tests for lib/seasons/seasonEngine.ts
 *
 * lib/seasons/seasonEngine.ts has been migrated to Drizzle ORM (getDb() /
 * orm.transaction() / the query builder) instead of the raw `@/lib/db`
 * adapter. Rather than hand-mock every `.select()/.insert()/.update()`
 * chain shape (which would silently drift from what Drizzle actually
 * compiles), these tests back a *real* `drizzle-orm/node-postgres`
 * instance with a fake `pg`-shaped client whose `query()` is a jest.fn.
 * Every query the engine issues still goes through real Drizzle query
 * compilation — exactly like production — and lands on `mockQuery` as
 * plain SQL text + params, which tests dispatch on (see
 * lib/quests/__tests__/questEngine.test.ts for the same pattern).
 *
 * Date.now() is mocked where needed to test phase boundary conditions
 * precisely (getSeasonPhase / isSeasonActive are pure and need no db mock).
 */

// ---------------------------------------------------------------------------
// Build a real Drizzle instance backed by a mock client, then mock
// @/lib/db/drizzle's getDb() to return it (several seasonEngine functions
// call getDb() directly for their transactional operations, ignoring the
// `db` param they also accept — so tests pass `mockDb` as both).
// ---------------------------------------------------------------------------

import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/drizzle";

const mockQuery = jest.fn();

const fakeClient = {
  query: (queryConfig: unknown, params?: unknown[]) => {
    const text = typeof queryConfig === "string" ? queryConfig : (queryConfig as { text: string }).text;
    return mockQuery(text, params);
  },
};

// `as any` on the client sidesteps drizzle-orm's `$client: Pool` typing
// (a real Pool isn't needed at runtime — drizzle only ever calls
// `client.query()` for a non-Pool client, including inside transactions).
const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

const mockCreditCoins = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/economy/coins", () => ({
  creditCoins: (...args: unknown[]) => mockCreditCoins(...args),
}));

jest.mock("@/lib/alerts/dispatch", () => ({
  raiseAlert: jest.fn().mockResolvedValue(undefined),
}));

// seasonEngine.ts does not import `@/lib/db` (the raw adapter) directly, but
// other modules in the require graph may — keep this mocked defensively so
// no test accidentally opens a real connection.
jest.mock("@/lib/db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  getCurrentSeason,
  getSeasonPhase,
  isSeasonActive,
  resetSeasonRankings,
  archiveSeasonForUser,
  distributeSeasonRewards,
  type Season,
  type SeasonPhase,
} from "@/lib/seasons/seasonEngine";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockCreditCoins.mockClear();
});

/** Build a Season fixture with configurable start/end dates. */
function buildSeason(overrides: Partial<Season> = {}): Season {
  const now = Date.now();
  return {
    id: "season-1",
    name: "Test Season",
    theme: "Warriors",
    starts_at: new Date(now - 7 * 24 * 3600000).toISOString(), // 7 days ago
    ends_at: new Date(now + 7 * 24 * 3600000).toISOString(), // 7 days from now
    is_active: true,
    pass_price_coins: 500,
    reward_pool_coins: 10000,
    created_at: new Date(now - 30 * 24 * 3600000).toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getCurrentSeason
// ---------------------------------------------------------------------------

describe("getCurrentSeason", () => {
  it("returns null when no active season exists", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await getCurrentSeason(mockDb);
    expect(result).toBeNull();
  });

  it("returns the active season when one exists", async () => {
    const now = Date.now();
    // Row is in pg's positional ("array") row mode, matching the
    // `.select({...})` column order in getCurrentSeason.
    const row = [
      "season-1",
      "Test Season",
      "Warriors",
      new Date(now - 7 * 24 * 3600000),
      new Date(now + 7 * 24 * 3600000),
      true,
      500,
      10000,
      new Date(now - 30 * 24 * 3600000),
    ];
    mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });

    const result = await getCurrentSeason(mockDb);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("season-1");
    expect(result!.is_active).toBe(true);
  });

  it("queries with is_active = true condition", async () => {
    await getCurrentSeason(mockDb);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('"seasons"."is_active" = $1');
    expect(params[0]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isSeasonActive
// ---------------------------------------------------------------------------

describe("isSeasonActive", () => {
  it("returns true for an active season within date bounds", () => {
    const season = buildSeason({ is_active: true });
    expect(isSeasonActive(season)).toBe(true);
  });

  it("returns false for a season with is_active = false", () => {
    const season = buildSeason({ is_active: false });
    expect(isSeasonActive(season)).toBe(false);
  });

  it("returns false when start date is in the future", () => {
    const now = Date.now();
    const season = buildSeason({
      is_active: true,
      starts_at: new Date(now + 24 * 3600000).toISOString(), // tomorrow
      ends_at: new Date(now + 14 * 24 * 3600000).toISOString(),
    });
    expect(isSeasonActive(season)).toBe(false);
  });

  it("returns false when end date is in the past", () => {
    const now = Date.now();
    const season = buildSeason({
      is_active: true,
      starts_at: new Date(now - 14 * 24 * 3600000).toISOString(),
      ends_at: new Date(now - 24 * 3600000).toISOString(), // yesterday
    });
    expect(isSeasonActive(season)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSeasonPhase
// ---------------------------------------------------------------------------

describe("getSeasonPhase", () => {
  /**
   * Build a season where `now` is at a specific elapsed ratio.
   * The season spans 100 days total for easy math.
   */
  function buildSeasonAtRatio(ratio: number): Season {
    const totalMs = 100 * 24 * 3600000; // 100 days
    const now = Date.now();
    const start = now - Math.floor(ratio * totalMs);
    const end = start + totalMs;
    return buildSeason({
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
    });
  }

  it('returns "opening" for the first 25% of the season', () => {
    const season = buildSeasonAtRatio(0.1); // 10% elapsed
    expect(getSeasonPhase(season)).toBe("opening");
  });

  it('returns "opening" at exactly 0% elapsed', () => {
    const season = buildSeasonAtRatio(0.001); // just started
    expect(getSeasonPhase(season)).toBe("opening");
  });

  it('returns "mid" between 25% and 75% of the season', () => {
    expect(getSeasonPhase(buildSeasonAtRatio(0.3))).toBe("mid");
    expect(getSeasonPhase(buildSeasonAtRatio(0.5))).toBe("mid");
    expect(getSeasonPhase(buildSeasonAtRatio(0.74))).toBe("mid");
  });

  it('returns "push" between 75% and 95% of the season', () => {
    expect(getSeasonPhase(buildSeasonAtRatio(0.76))).toBe("push");
    expect(getSeasonPhase(buildSeasonAtRatio(0.85))).toBe("push");
    expect(getSeasonPhase(buildSeasonAtRatio(0.94))).toBe("push");
  });

  it('returns "final_day" for the last 5% of the season', () => {
    const season = buildSeasonAtRatio(0.97); // 97% elapsed
    expect(getSeasonPhase(season)).toBe("final_day");
  });

  it('returns "final_day" when less than 24 hours remain', () => {
    const now = Date.now();
    const season = buildSeason({
      starts_at: new Date(now - 27 * 24 * 3600000).toISOString(),
      ends_at: new Date(now + 12 * 3600000).toISOString(), // 12 hours remaining
    });
    expect(getSeasonPhase(season)).toBe("final_day");
  });

  it("returns a SeasonPhase string (one of the four valid values)", () => {
    const validPhases: SeasonPhase[] = ["opening", "mid", "push", "final_day"];
    const season = buildSeasonAtRatio(0.5);
    const phase = getSeasonPhase(season);
    expect(validPhases).toContain(phase);
  });
});

// ---------------------------------------------------------------------------
// resetSeasonRankings
// ---------------------------------------------------------------------------

describe("resetSeasonRankings", () => {
  it("archives rankings before resetting them", async () => {
    await resetSeasonRankings("season-1", mockDb);

    const queries = mockQuery.mock.calls.map(([text]) => text as string);
    const archiveQuery = queries.find((q) => q.includes("INSERT INTO season_rank_archives"));
    const resetQuery = queries.find((q) => q.includes('update "user_season_passes"'));
    const deactivateQuery = queries.find((q) => q.includes('update "seasons"') && q.includes('"is_active"'));

    expect(archiveQuery).toBeDefined();
    expect(resetQuery).toBeDefined();
    expect(deactivateQuery).toBeDefined();
  });

  it("resets season_xp to 0 in user_season_passes", async () => {
    await resetSeasonRankings("season-42", mockDb);

    const call = mockQuery.mock.calls.find(
      ([text]) => typeof text === "string" && text.includes('update "user_season_passes"')
    );
    expect(call).toBeDefined();
    const [sql, params] = call as [string, unknown[]];
    expect(sql).toContain('"season_xp" = $1');
    expect(sql).toContain('"season_rank" = $2');
    expect(params[0]).toBe(0n); // seasonXp is a bigint column
    expect(params[1]).toBeNull();
    expect(params).toContain("season-42");
  });

  it("marks the season as inactive", async () => {
    await resetSeasonRankings("season-5", mockDb);

    const call = mockQuery.mock.calls.find(
      ([text]) => typeof text === "string" && text.includes('update "seasons"') && text.includes('"is_active"')
    );
    expect(call).toBeDefined();
    const [sql, params] = call as [string, unknown[]];
    expect(sql).toContain('"is_active" = $1');
    expect(params[0]).toBe(false);
    expect(params).toContain("season-5");
  });
});

// ---------------------------------------------------------------------------
// archiveSeasonForUser
// ---------------------------------------------------------------------------

describe("archiveSeasonForUser", () => {
  it("inserts a season_rank_archives entry for the user", async () => {
    await archiveSeasonForUser("user-1", "season-1", 3, mockDb);

    const call = mockQuery.mock.calls.find(
      ([text]) => typeof text === "string" && (text as string).includes("INSERT INTO season_rank_archives")
    );
    expect(call).toBeDefined();
    const [, params] = call as [string, unknown[]];
    expect(params).toContain("season-1");
    expect(params).toContain("user-1");
    expect(params).toContain(3);
  });

  it("is safe to call multiple times (upserts on conflict)", async () => {
    // Call twice — should not throw
    await archiveSeasonForUser("user-1", "season-1", 1, mockDb);
    await archiveSeasonForUser("user-1", "season-1", 1, mockDb);

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("includes ON CONFLICT DO UPDATE in the query", async () => {
    await archiveSeasonForUser("user-1", "season-1", 5, mockDb);

    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("DO UPDATE");
  });
});

// ---------------------------------------------------------------------------
// distributeSeasonRewards
// ---------------------------------------------------------------------------

describe("distributeSeasonRewards", () => {
  /** Wire up the claim + top-users queries that every non-early-exit test needs. */
  function mockClaimAndTopUsers(pool: number, topUsers: { userId: string; finalRank: number }[]) {
    mockQuery.mockImplementation((text: string) => {
      // Reward distribution is claimed atomically via
      // `UPDATE seasons ... RETURNING id, reward_pool_coins` (BUG-023 fix).
      if (text.startsWith('update "seasons"') && text.includes("returning")) {
        return Promise.resolve({ rows: [["season-1", pool]], rowCount: 1 });
      }
      if (text.includes('from "season_rank_archives"')) {
        return Promise.resolve({
          rows: topUsers.map((u) => [u.userId, u.finalRank]),
          rowCount: topUsers.length,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  it("throws when season is not found", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(distributeSeasonRewards("nonexistent-season", mockDb)).rejects.toThrow("Season not found");
  });

  it("credits 25% of pool to rank-1 user", async () => {
    const POOL = 10000;
    const expectedRank1Share = Math.floor(POOL * 0.25); // 2500

    mockClaimAndTopUsers(POOL, [
      { userId: "user-1", finalRank: 1 },
      { userId: "user-2", finalRank: 2 },
      { userId: "user-3", finalRank: 3 },
      { userId: "user-4", finalRank: 4 },
    ]);

    await distributeSeasonRewards("season-1", mockDb);

    const call = mockCreditCoins.mock.calls.find((c) => c[0] === "user-1");
    expect(call).toBeDefined();
    expect(call![1]).toBe(expectedRank1Share);
    expect(call![2]).toBe("season_reward");
  });

  it("credits 15% of pool to rank-2 user", async () => {
    const POOL = 10000;
    const expectedRank2Share = Math.floor(POOL * 0.15); // 1500

    // 4+ users so the normal fixed-tier path is exercised (fewer than 4
    // placed users triggers proportional redistribution of unallocated tiers).
    mockClaimAndTopUsers(POOL, [
      { userId: "user-1", finalRank: 1 },
      { userId: "user-2", finalRank: 2 },
      { userId: "user-3", finalRank: 3 },
      { userId: "user-4", finalRank: 4 },
    ]);

    await distributeSeasonRewards("season-1", mockDb);

    const call = mockCreditCoins.mock.calls.find((c) => c[0] === "user-2");
    expect(call).toBeDefined();
    expect(call![1]).toBe(expectedRank2Share);
  });

  it("awards season badge to all top-10 users", async () => {
    const POOL = 5000;
    const topUsers = Array.from({ length: 5 }, (_, i) => ({ userId: `user-${i + 1}`, finalRank: i + 1 }));
    mockClaimAndTopUsers(POOL, topUsers);

    await distributeSeasonRewards("season-1", mockDb);

    const badgeInserts = mockQuery.mock.calls.filter(
      ([text]) => typeof text === "string" && (text as string).includes('insert into "user_badges"')
    );
    // One badge per user
    expect(badgeInserts.length).toBe(5);
    for (const [, params] of badgeInserts) {
      expect(params).toContain("season_top10");
      expect(params).toContain("season_top10:season-1");
    }
  });

  it("splits ranks 4-10 equally from the remaining 50% of pool", async () => {
    const POOL = 10000;
    // ranks 1-3 take 50%, remaining 50% = 5000 split among 7 users → 714 each
    const rank4to10Share = Math.floor((POOL * 0.5) / 7); // 714

    const topUsers = Array.from({ length: 10 }, (_, i) => ({ userId: `user-${i + 1}`, finalRank: i + 1 }));
    mockClaimAndTopUsers(POOL, topUsers);

    await distributeSeasonRewards("season-1", mockDb);

    // Ranks 5-10 (indices 4-9) get the plain per-user share; rank 4 (index 3)
    // absorbs the floor-rounding dust on top of that share (see seasonEngine's
    // BUG-46 redistribution comment), so it is checked separately.
    for (let i = 4; i < topUsers.length; i++) {
      const call = mockCreditCoins.mock.calls.find((c) => c[0] === `user-${i + 1}`);
      expect(call).toBeDefined();
      expect(call![1]).toBe(rank4to10Share);
    }
    const rank4Call = mockCreditCoins.mock.calls.find((c) => c[0] === "user-4");
    expect(rank4Call).toBeDefined();
    expect(rank4Call![1]).toBeGreaterThanOrEqual(rank4to10Share);
  });
});
