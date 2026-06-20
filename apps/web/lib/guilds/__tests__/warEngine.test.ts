/**
 * Unit tests for the guild war engine.
 *
 * Database is fully mocked. jest.useFakeTimers() is used where Final Hour
 * detection depends on wall-clock time.
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
  calculateWarPoints,
  findWarOpponent,
  resolveWar,
  distributeWarRewards,
  FINAL_HOUR_MULTIPLIER,
  WAR_DURATION_HOURS,
  WAR_COOLDOWN_HOURS,
} from '@/lib/guilds/warEngine';
import type { DatabaseAdapter, TransactionClient } from '@/lib/db/interface';
import { db as globalDb } from '@/lib/db';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  (globalDb.query as jest.Mock).mockReset();
  (globalDb.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });
  (globalDb.transaction as jest.Mock).mockReset();
});

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

// ---------------------------------------------------------------------------
// calculateWarPoints
// ---------------------------------------------------------------------------

describe('calculateWarPoints', () => {
  it('returns correct base points for send_message (1)', () => {
    expect(calculateWarPoints('send_message', false)).toBe(1);
  });

  it('returns correct base points for react_to_message (2)', () => {
    expect(calculateWarPoints('react_to_message', false)).toBe(2);
  });

  it('returns correct base points for join_room (5)', () => {
    expect(calculateWarPoints('join_room', false)).toBe(5);
  });

  it('returns correct base points for host_room (20)', () => {
    expect(calculateWarPoints('host_room', false)).toBe(20);
  });

  it('returns correct base points for send_gift (15)', () => {
    expect(calculateWarPoints('send_gift', false)).toBe(15);
  });

  it('returns correct base points for complete_quest (30)', () => {
    expect(calculateWarPoints('complete_quest', false)).toBe(30);
  });

  it('returns correct base points for refer_user (50)', () => {
    expect(calculateWarPoints('refer_user', false)).toBe(50);
  });

  it('doubles points during Final Hour (FINAL_HOUR_MULTIPLIER = 2)', () => {
    expect(FINAL_HOUR_MULTIPLIER).toBe(2);

    expect(calculateWarPoints('send_message', true)).toBe(2);    // 1 × 2
    expect(calculateWarPoints('complete_quest', true)).toBe(60); // 30 × 2
    expect(calculateWarPoints('refer_user', true)).toBe(100);    // 50 × 2
  });

  it('normal and final-hour points differ by exactly FINAL_HOUR_MULTIPLIER', () => {
    const activities = [
      'send_message', 'react_to_message', 'join_room',
      'host_room', 'send_gift', 'complete_quest', 'refer_user',
    ] as const;

    for (const activity of activities) {
      const normal = calculateWarPoints(activity, false);
      const finalHour = calculateWarPoints(activity, true);
      expect(finalHour).toBe(normal * FINAL_HOUR_MULTIPLIER);
    }
  });

  it('always returns a positive integer', () => {
    const result = calculateWarPoints('send_message', false);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('War engine constants', () => {
  it('WAR_DURATION_HOURS is 48', () => {
    expect(WAR_DURATION_HOURS).toBe(48);
  });

  it('WAR_COOLDOWN_HOURS is 72', () => {
    expect(WAR_COOLDOWN_HOURS).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// findWarOpponent
// ---------------------------------------------------------------------------

describe('findWarOpponent', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when the declaring guild is not found', async () => {
    const mockDb = buildMockDb({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });

    const result = await findWarOpponent('nonexistent-guild', mockDb);
    expect(result).toBeNull();
  });

  it('returns null when no eligible opponents exist', async () => {
    let callCount = 0;
    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string) => {
        callCount++;
        if (sql.includes('SELECT id, guild_xp, city FROM guilds')) {
          return { rows: [{ id: 'guild-a', guild_xp: 10000, city: 'Lagos' }], rowCount: 1 };
        }
        if (sql.includes('guild_wars')) {
          return { rows: [], rowCount: 0 };
        }
        // No candidates
        return { rows: [], rowCount: 0 };
      }),
    });

    const result = await findWarOpponent('guild-a', mockDb);
    expect(result).toBeNull();
  });

  it('returns an opponent guild within ±15% XP range', async () => {
    const selfXP = 10000;
    const opponentXP = 10500; // within ±15% of 10000

    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, guild_xp, city FROM guilds')) {
          return { rows: [{ id: 'guild-a', guild_xp: selfXP, city: null }], rowCount: 1 };
        }
        if (sql.includes('guild_wars')) {
          return { rows: [], rowCount: 0 }; // no active wars
        }
        if (sql.includes('SELECT g.id FROM guilds g')) {
          return { rows: [{ id: 'guild-b' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    });

    const result = await findWarOpponent('guild-a', mockDb);
    expect(result).toBe('guild-b');
  });

  it('does not return the declaring guild as its own opponent', async () => {
    // Exclusion of busy guilds (including self) happens SQL-side via
    // `g.id != ALL($4::uuid[])`, not via post-filtering in JS. So we assert
    // that the declaring guild's id is included in the exclusion param, and
    // simulate the SQL-side filtering by returning no candidates.
    let candidateParams: unknown[] | undefined;
    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id, guild_xp, city FROM guilds')) {
          return { rows: [{ id: 'guild-a', guild_xp: 5000, city: null }], rowCount: 1 };
        }
        if (sql.includes('guild_wars')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT g.id FROM guilds g')) {
          candidateParams = params;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    });

    const result = await findWarOpponent('guild-a', mockDb);
    expect(result).toBeNull();
    expect(candidateParams?.[3]).toContain('guild-a');
  });

  it('does not return a guild that is currently at war', async () => {
    // Same as above — the busy-guild exclusion (guilds with an active war)
    // is applied SQL-side, so assert it's present in the exclusion param.
    let candidateParams: unknown[] | undefined;
    const mockDb = buildMockDb({
      query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id, guild_xp, city FROM guilds')) {
          return { rows: [{ id: 'guild-a', guild_xp: 5000, city: null }], rowCount: 1 };
        }
        if (sql.includes('guild_wars')) {
          // guild-b is already in an active war
          return {
            rows: [{ guild_id: 'guild-b' }, { guild_id: 'guild-c' }],
            rowCount: 2,
          };
        }
        if (sql.includes('SELECT g.id FROM guilds g')) {
          candidateParams = params;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    });

    const result = await findWarOpponent('guild-a', mockDb);
    expect(result).toBeNull();
    expect(candidateParams?.[3]).toContain('guild-b');
  });
});

// ---------------------------------------------------------------------------
// resolveWar
// ---------------------------------------------------------------------------

describe('resolveWar', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('throws when war is not found', async () => {
    const mockDb = buildMockDb({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });
    await expect(resolveWar('nonexistent-war', mockDb)).rejects.toThrow('War not found');
  });

  it('throws when war is already completed', async () => {
    // resolveWar reads the war row via client.query() inside db.transaction(),
    // not via the outer db.query(), so the war row must be mocked on the
    // transaction's client.
    const mockTx: TransactionClient = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: 'war-1',
          challenger_guild_id: 'guild-a',
          defender_guild_id: 'guild-b',
          status: 'completed',
          challenger_points: 100,
          defender_points: 50,
          winner_guild_id: 'guild-a',
          starts_at: new Date().toISOString(),
          ends_at: new Date().toISOString(),
          final_hour_starts_at: new Date().toISOString(),
        }],
        rowCount: 1,
      }),
    };
    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });
    await expect(resolveWar('war-1', mockDb)).rejects.toThrow('already resolved');
  });

  it('throws when war is cancelled', async () => {
    const mockTx: TransactionClient = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          id: 'war-1',
          challenger_guild_id: 'guild-a',
          defender_guild_id: 'guild-b',
          status: 'cancelled',
          challenger_points: 0,
          defender_points: 0,
          winner_guild_id: null,
          starts_at: new Date().toISOString(),
          ends_at: new Date().toISOString(),
          final_hour_starts_at: new Date().toISOString(),
        }],
        rowCount: 1,
      }),
    };
    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });
    await expect(resolveWar('war-1', mockDb)).rejects.toThrow('already resolved');
  });

  it('correctly identifies the challenger as winner when challenger has more points', async () => {
    const warRow = {
      id: 'war-1',
      challenger_guild_id: 'guild-a',
      defender_guild_id: 'guild-b',
      status: 'active',
      challenger_points: 500,
      defender_points: 300,
      winner_guild_id: null,
      starts_at: new Date(Date.now() - 48 * 3600000).toISOString(),
      ends_at: new Date(Date.now() - 1000).toISOString(),
      final_hour_starts_at: new Date(Date.now() - 3600000 - 1000).toISOString(),
    };

    const mockTx: TransactionClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };

    // War row and winning-guild member rows are both read via client.query()
    // inside the transaction.
    (mockTx.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM guild_wars')) {
        return { rows: [warRow], rowCount: 1 };
      }
      if (sql.includes('FROM guild_members gm')) {
        return { rows: [{ user_id: 'member-1', war_points: 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    const result = await resolveWar('war-1', mockDb);
    expect(result.winnerGuildId).toBe('guild-a');
    expect(result.loserGuildId).toBe('guild-b');
  });

  it('correctly identifies the defender as winner when defender has more points', async () => {
    const warRow = {
      id: 'war-2',
      challenger_guild_id: 'guild-a',
      defender_guild_id: 'guild-b',
      status: 'active',
      challenger_points: 200,
      defender_points: 800,
      winner_guild_id: null,
      starts_at: new Date(Date.now() - 48 * 3600000).toISOString(),
      ends_at: new Date(Date.now() - 1000).toISOString(),
      final_hour_starts_at: new Date(Date.now() - 3600000 - 1000).toISOString(),
    };

    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM guild_wars')) {
          return { rows: [warRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    const result = await resolveWar('war-2', mockDb);
    expect(result.winnerGuildId).toBe('guild-b');
    expect(result.loserGuildId).toBe('guild-a');
  });

  it('is recorded as a draw when points are equal', async () => {
    const warRow = {
      id: 'war-3',
      challenger_guild_id: 'guild-a',
      defender_guild_id: 'guild-b',
      status: 'active',
      challenger_points: 400,
      defender_points: 400,
      winner_guild_id: null,
      starts_at: new Date(Date.now() - 48 * 3600000).toISOString(),
      ends_at: new Date(Date.now() - 1000).toISOString(),
      final_hour_starts_at: new Date(Date.now() - 3600000 - 1000).toISOString(),
    };

    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM guild_wars')) {
          return { rows: [warRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    const result = await resolveWar('war-3', mockDb);
    // Equal points → draw; no winner, both guilds get wars_drawn
    expect(result.outcome).toBe('draw');
    expect(result.winnerGuildId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// distributeWarRewards
// ---------------------------------------------------------------------------

describe('distributeWarRewards', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing when there are no member contributions', async () => {
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT wc.user_id')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    // Should not throw
    await expect(distributeWarRewards('war-1', 'guild-a', mockDb)).resolves.toBeUndefined();
  });

  it('allocates 30% of the pool to the top contributor', async () => {
    const POOL = 2000;
    const expectedTopShare = Math.floor(POOL * 0.3); // 600

    const members = [
      { user_id: 'user-1', guild_id: 'guild-a', war_points: 1000, username: 'alice' },
      { user_id: 'user-2', guild_id: 'guild-a', war_points: 500, username: 'bob' },
      { user_id: 'user-3', guild_id: 'guild-a', war_points: 200, username: 'charlie' },
    ];

    const updateQueries: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT wc.user_id')) {
          return { rows: members, rowCount: members.length };
        }
        if (sql.includes('SELECT coin_balance FROM users')) {
          return { rows: [{ coin_balance: '0' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO coin_ledger')) {
          return { rows: [{ id: 'lid', user_id: params[0], amount: params[1], balance_before: params[2], balance_after: params[3], transaction_type: params[4], reference_id: params[5] ?? null, description: params[6] ?? null, metadata: null, created_at: new Date().toISOString() }], rowCount: 1 };
        }
        if (sql.includes('UPDATE users SET coin_balance')) {
          updateQueries.push({ sql, params });
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await distributeWarRewards('war-1', 'guild-a', mockDb);

    // First UPDATE should be for user-1 with 600 coins (30% of 2000).
    // creditCoins writes balanceAfter as a string via Decimal#toFixed, and
    // params are [balanceAfter, userId].
    const firstUpdate = updateQueries[0];
    expect(firstUpdate).toBeDefined();
    expect(firstUpdate.params[0]).toBe(String(expectedTopShare));
    expect(firstUpdate.params[1]).toBe('user-1');
  });

  it('allocates 20% of the pool to the second contributor', async () => {
    const POOL = 2000;
    const expectedSecondShare = Math.floor(POOL * 0.2); // 400

    const members = [
      { user_id: 'user-1', guild_id: 'guild-a', war_points: 1000, username: 'alice' },
      { user_id: 'user-2', guild_id: 'guild-a', war_points: 500, username: 'bob' },
    ];

    const updateQueries: Array<{ sql: string; params: unknown[] }> = [];
    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT wc.user_id')) {
          return { rows: members, rowCount: members.length };
        }
        if (sql.includes('SELECT coin_balance FROM users')) {
          return { rows: [{ coin_balance: '0' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO coin_ledger')) {
          return { rows: [{ id: 'lid', user_id: params[0], amount: params[1], balance_before: params[2], balance_after: params[3], transaction_type: params[4], reference_id: params[5] ?? null, description: params[6] ?? null, metadata: null, created_at: new Date().toISOString() }], rowCount: 1 };
        }
        if (sql.includes('UPDATE users SET coin_balance')) {
          updateQueries.push({ sql, params });
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    await distributeWarRewards('war-1', 'guild-a', mockDb);

    // Second UPDATE should be for user-2 with 400 coins (20% of 2000)
    const secondUpdate = updateQueries[1];
    expect(secondUpdate).toBeDefined();
    expect(secondUpdate.params[0]).toBe(String(expectedSecondShare));
    expect(secondUpdate.params[1]).toBe('user-2');
  });

  it('queues top contributor bonus XP for rank-1 member', async () => {
    const members = [
      { user_id: 'user-1', guild_id: 'guild-a', war_points: 999, username: 'alice' },
    ];

    const mockTx: TransactionClient = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('SELECT wc.user_id')) {
          return { rows: members, rowCount: members.length };
        }
        if (sql.includes('SELECT coin_balance FROM users')) {
          return { rows: [{ coin_balance: '0' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO coin_ledger')) {
          return { rows: [{ id: 'lid', user_id: params[0], amount: params[1], balance_before: params[2], balance_after: params[3], transaction_type: params[4], reference_id: params[5] ?? null, description: params[6] ?? null, metadata: null, created_at: new Date().toISOString() }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockDb = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        return fn(mockTx);
      }),
    });

    // distributeWarRewards defers XP awards via pendingXPAwards so the caller
    // (resolveWar) can issue them post-commit, avoiding phantom DLQ entries.
    const pendingXPAwards: Array<{ userId: string; amount: number; track: string; source: string; ref: string }> = [];
    await distributeWarRewards('war-1', 'guild-a', mockDb, undefined, pendingXPAwards);

    expect(pendingXPAwards.length).toBeGreaterThan(0);
    expect(pendingXPAwards[0].userId).toBe('user-1');
    expect(pendingXPAwards[0].amount).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Final Hour detection via fake timers
// ---------------------------------------------------------------------------

describe('Final Hour detection with fake timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('points are normal outside the Final Hour', () => {
    // Not in Final Hour
    const points = calculateWarPoints('complete_quest', false);
    expect(points).toBe(30);
  });

  it('points are doubled when Final Hour flag is true', () => {
    // Simulating Final Hour
    const points = calculateWarPoints('complete_quest', true);
    expect(points).toBe(60);
  });

  it('Final Hour multiplier constant equals 2', () => {
    expect(FINAL_HOUR_MULTIPLIER).toBe(2);
  });
});
