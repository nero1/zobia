/**
 * Unit tests for the season engine.
 *
 * Database is fully mocked. Date.now() is mocked where needed to test
 * phase boundary conditions precisely.
 */

// ---------------------------------------------------------------------------
// Mock @/lib/db
// ---------------------------------------------------------------------------

jest.mock('@/lib/db', () => ({
  db: {
    query: jest.fn(),
    transaction: jest.fn(),
    healthCheck: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Imports
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
} from '@/lib/seasons/seasonEngine';
import type { DatabaseAdapter, TransactionClient } from '@/lib/db/interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockDb(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
      const mockTx: TransactionClient = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      };
      return fn(mockTx);
    }),
    healthCheck: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Build a Season fixture with configurable start/end dates. */
function buildSeason(overrides: Partial<Season> = {}): Season {
  const now = Date.now();
  return {
    id: 'season-1',
    name: 'Test Season',
    theme: 'Warriors',
    starts_at: new Date(now - 7 * 24 * 3600000).toISOString(), // 7 days ago
    ends_at: new Date(now + 7 * 24 * 3600000).toISOString(),   // 7 days from now
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

describe('getCurrentSeason', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns null when no active season exists', async () => {
    const mockDb = buildMockDb({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });

    const result = await getCurrentSeason(mockDb);
    expect(result).toBeNull();
  });

  it('returns the active season when one exists', async () => {
    const season = buildSeason();
    const mockDb = buildMockDb({
      query: jest.fn().mockResolvedValue({ rows: [season], rowCount: 1 }),
    });

    const result = await getCurrentSeason(mockDb);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('season-1');
    expect(result!.is_active).toBe(true);
  });

  it('queries with is_active = TRUE condition', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const mockDb = buildMockDb({ query: mockQuery });

    await getCurrentSeason(mockDb);

    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('is_active = TRUE');
  });
});

// ---------------------------------------------------------------------------
// isSeasonActive
// ---------------------------------------------------------------------------

describe('isSeasonActive', () => {
  it('returns true for an active season within date bounds', () => {
    const season = buildSeason({ is_active: true });
    expect(isSeasonActive(season)).toBe(true);
  });

  it('returns false for a season with is_active = false', () => {
    const season = buildSeason({ is_active: false });
    expect(isSeasonActive(season)).toBe(false);
  });

  it('returns false when start date is in the future', () => {
    const now = Date.now();
    const season = buildSeason({
      is_active: true,
      starts_at: new Date(now + 24 * 3600000).toISOString(), // tomorrow
      ends_at: new Date(now + 14 * 24 * 3600000).toISOString(),
    });
    expect(isSeasonActive(season)).toBe(false);
  });

  it('returns false when end date is in the past', () => {
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

describe('getSeasonPhase', () => {
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
    const season = buildSeasonAtRatio(0.10); // 10% elapsed
    expect(getSeasonPhase(season)).toBe('opening');
  });

  it('returns "opening" at exactly 0% elapsed', () => {
    const season = buildSeasonAtRatio(0.001); // just started
    expect(getSeasonPhase(season)).toBe('opening');
  });

  it('returns "mid" between 25% and 75% of the season', () => {
    expect(getSeasonPhase(buildSeasonAtRatio(0.30))).toBe('mid');
    expect(getSeasonPhase(buildSeasonAtRatio(0.50))).toBe('mid');
    expect(getSeasonPhase(buildSeasonAtRatio(0.74))).toBe('mid');
  });

  it('returns "push" between 75% and 95% of the season', () => {
    expect(getSeasonPhase(buildSeasonAtRatio(0.76))).toBe('push');
    expect(getSeasonPhase(buildSeasonAtRatio(0.85))).toBe('push');
    expect(getSeasonPhase(buildSeasonAtRatio(0.94))).toBe('push');
  });

  it('returns "final_day" for the last 5% of the season', () => {
    const season = buildSeasonAtRatio(0.97); // 97% elapsed
    expect(getSeasonPhase(season)).toBe('final_day');
  });

  it('returns "final_day" when less than 24 hours remain', () => {
    const now = Date.now();
    const season = buildSeason({
      starts_at: new Date(now - 27 * 24 * 3600000).toISOString(),
      ends_at: new Date(now + 12 * 3600000).toISOString(), // 12 hours remaining
    });
    expect(getSeasonPhase(season)).toBe('final_day');
  });

  it('returns a SeasonPhase string (one of the four valid values)', () => {
    const validPhases: SeasonPhase[] = ['opening', 'mid', 'push', 'final_day'];
    const season = buildSeasonAtRatio(0.5);
    const phase = getSeasonPhase(season);
    expect(validPhases).toContain(phase);
  });
});

// ---------------------------------------------------------------------------
// resetSeasonRankings
// ---------------------------------------------------------------------------

describe('resetSeasonRankings', () => {
  afterEach(() => jest.clearAllMocks());

  it('archives rankings before resetting them', async () => {
    const queries: string[] = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await resetSeasonRankings('season-1', mockDb);

    const archiveQuery = queries.find((q) => q.includes('INSERT INTO season_rank_archives'));
    const resetQuery = queries.find((q) => q.includes('UPDATE season_passes'));
    const deactivateQuery = queries.find((q) => q.includes("is_active = FALSE"));

    expect(archiveQuery).toBeDefined();
    expect(resetQuery).toBeDefined();
    expect(deactivateQuery).toBeDefined();
  });

  it('resets season_xp to 0 in season_passes', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await resetSeasonRankings('season-42', mockDb);

    const resetQuery = queries.find((q) => q.sql.includes('UPDATE season_passes') && q.sql.includes('season_xp = 0'));
    expect(resetQuery).toBeDefined();
    expect(resetQuery!.params).toContain('season-42');
  });

  it('marks the season as inactive', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await resetSeasonRankings('season-5', mockDb);

    const deactivate = queries.find((q) => q.sql.includes("is_active = FALSE") && q.params.includes('season-5'));
    expect(deactivate).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// archiveSeasonForUser
// ---------------------------------------------------------------------------

describe('archiveSeasonForUser', () => {
  afterEach(() => jest.clearAllMocks());

  it('inserts a season_rank_archives entry for the user', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      }),
    });

    await archiveSeasonForUser('user-1', 'season-1', 3, mockDb);

    const insertQuery = queries.find((q) => q.sql.includes('INSERT INTO season_rank_archives'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.params).toContain('season-1');
    expect(insertQuery!.params).toContain('user-1');
    expect(insertQuery!.params).toContain(3);
  });

  it('is safe to call multiple times (upserts on conflict)', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const mockDb = buildMockDb({ query: mockQuery });

    // Call twice — should not throw
    await archiveSeasonForUser('user-1', 'season-1', 1, mockDb);
    await archiveSeasonForUser('user-1', 'season-1', 1, mockDb);

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('includes ON CONFLICT DO UPDATE in the query', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      }),
    });

    await archiveSeasonForUser('user-1', 'season-1', 5, mockDb);

    const query = queries[0];
    expect(query.sql).toContain('ON CONFLICT');
    expect(query.sql).toContain('DO UPDATE');
  });
});

// ---------------------------------------------------------------------------
// distributeSeasonRewards
// ---------------------------------------------------------------------------

describe('distributeSeasonRewards', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws when season is not found', async () => {
    const mockDb = buildMockDb({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });

    await expect(distributeSeasonRewards('nonexistent-season', mockDb)).rejects.toThrow(
      'Season not found'
    );
  });

  it('distributes 25% of pool to rank-1 user', async () => {
    const POOL = 10000;
    const expectedRank1Share = Math.floor(POOL * 0.25); // 2500

    const topUsers = [
      { user_id: 'user-1', final_rank: 1 },
      { user_id: 'user-2', final_rank: 2 },
      { user_id: 'user-3', final_rank: 3 },
      { user_id: 'user-4', final_rank: 4 },
    ];

    const coinUpdates: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('UPDATE users SET coin_balance')) {
          coinUpdates.push({ sql, params });
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT reward_pool_coins FROM seasons')) {
          return { rows: [{ reward_pool_coins: POOL }], rowCount: 1 };
        }
        if (sql.includes('SELECT user_id, final_rank')) {
          return { rows: topUsers, rowCount: topUsers.length };
        }
        return { rows: [], rowCount: 0 };
      }),
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await distributeSeasonRewards('season-1', mockDb);

    // First update is for rank-1 user
    expect(coinUpdates[0]).toBeDefined();
    expect(coinUpdates[0].params[0]).toBe(expectedRank1Share);
    expect(coinUpdates[0].params[1]).toBe('user-1');
  });

  it('distributes 15% of pool to rank-2 user', async () => {
    const POOL = 10000;
    const expectedRank2Share = Math.floor(POOL * 0.15); // 1500

    const topUsers = [
      { user_id: 'user-1', final_rank: 1 },
      { user_id: 'user-2', final_rank: 2 },
    ];

    const coinUpdates: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('UPDATE users SET coin_balance')) {
          coinUpdates.push({ sql, params });
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT reward_pool_coins FROM seasons')) {
          return { rows: [{ reward_pool_coins: POOL }], rowCount: 1 };
        }
        if (sql.includes('SELECT user_id, final_rank')) {
          return { rows: topUsers, rowCount: topUsers.length };
        }
        return { rows: [], rowCount: 0 };
      }),
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await distributeSeasonRewards('season-1', mockDb);

    expect(coinUpdates[1]).toBeDefined();
    expect(coinUpdates[1].params[0]).toBe(expectedRank2Share);
    expect(coinUpdates[1].params[1]).toBe('user-2');
  });

  it('awards season badge to all top-10 users', async () => {
    const POOL = 5000;
    const topUsers = Array.from({ length: 5 }, (_, i) => ({
      user_id: `user-${i + 1}`,
      final_rank: i + 1,
    }));

    const badgeInserts: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO user_badges')) {
          badgeInserts.push({ sql, params });
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT reward_pool_coins')) {
          return { rows: [{ reward_pool_coins: POOL }], rowCount: 1 };
        }
        if (sql.includes('SELECT user_id, final_rank')) {
          return { rows: topUsers, rowCount: topUsers.length };
        }
        return { rows: [], rowCount: 0 };
      }),
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await distributeSeasonRewards('season-1', mockDb);

    // One badge per user
    expect(badgeInserts.length).toBe(5);
    for (const insert of badgeInserts) {
      expect(insert.sql).toContain('INSERT INTO user_badges');
      expect(insert.sql).toContain("'season_top10'");
    }
  });

  it('splits ranks 4-10 equally from the remaining 50% of pool', async () => {
    const POOL = 10000;
    // ranks 1-3 take 50%, remaining 50% = 5000 split among 7 users → 714 each
    const rank4to10Share = Math.floor((POOL * 0.5) / 7); // 714

    const topUsers = Array.from({ length: 10 }, (_, i) => ({
      user_id: `user-${i + 1}`,
      final_rank: i + 1,
    }));

    const coinUpdates: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('UPDATE users SET coin_balance')) {
          coinUpdates.push({ sql, params });
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT reward_pool_coins')) {
          return { rows: [{ reward_pool_coins: POOL }], rowCount: 1 };
        }
        if (sql.includes('SELECT user_id, final_rank')) {
          return { rows: topUsers, rowCount: topUsers.length };
        }
        return { rows: [], rowCount: 0 };
      }),
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await distributeSeasonRewards('season-1', mockDb);

    // Ranks 4-10 are at indices 3-9
    for (let i = 3; i < coinUpdates.length; i++) {
      expect(coinUpdates[i].params[0]).toBe(rank4to10Share);
    }
  });
});
