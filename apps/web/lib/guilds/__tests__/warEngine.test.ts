/**
 * Unit tests for the guild war engine.
 *
 * lib/guilds/warEngine.ts has been migrated to Drizzle ORM (db.execute /
 * db.transaction with the `sql` tagged template) instead of the raw
 * `@/lib/db` adapter. Rather than hand-mock every call shape, these tests
 * back a *real* `drizzle-orm/node-postgres` instance with a fake
 * `pg`-shaped client whose `query()` is a jest.fn. Every query the engine
 * issues still goes through real Drizzle compilation — exactly like
 * production — and lands on `mockQuery` as plain SQL text + params, which
 * tests dispatch on the same way the old raw-adapter tests dispatched on
 * `db.query`'s SQL string (see lib/quests/__tests__/questEngine.test.ts and
 * lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
 */

// ---------------------------------------------------------------------------
// Build a real Drizzle instance backed by a mock client. warEngine.ts takes
// its `db: DbOrTx` param directly (it does not call getDb() internally), so
// tests pass `mockDb` straight into each function under test.
// ---------------------------------------------------------------------------

import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";

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
const mockDb = drizzle(fakeClient as any, { schema }) as any;

// findWarOpponent reads the war cooldown override via getManifestValue,
// which (on a cache miss) falls back to a raw db call of its own — mocking
// it directly keeps the mocked query call sequence limited to the calls
// warEngine.ts itself makes, rather than needing every test to also
// account for the manifest lookup's internal query.
jest.mock('@/lib/manifest', () => ({
  getManifestValue: jest.fn().mockResolvedValue(null),
}));

const mockCreditCoins = jest.fn().mockResolvedValue({});
jest.mock('@/lib/economy/coins', () => ({
  creditCoins: (...args: unknown[]) => mockCreditCoins(...args),
}));

const mockSafeAwardXP = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/xp/safeAwardXP', () => ({
  safeAwardXP: (...args: unknown[]) => mockSafeAwardXP(...args),
}));

// warEngine.ts does not import `@/lib/db` (the raw adapter) directly, but
// keep it mocked defensively so no test accidentally opens a real connection.
jest.mock('@/lib/db', () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockCreditCoins.mockClear();
  mockSafeAwardXP.mockClear();
});

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
  it('returns null when the declaring guild is not found', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await findWarOpponent('nonexistent-guild', mockDb);
    expect(result).toBeNull();
  });

  it('returns null when no eligible opponents exist', async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('SELECT id, guild_xp, city FROM guilds')) {
        return Promise.resolve({ rows: [{ id: 'guild-a', guild_xp: 10000, city: 'Lagos' }], rowCount: 1 });
      }
      // Candidate query (BUG-026 fix merged the busy-guild check into this
      // single query via a NOT EXISTS ... guild_wars subquery — so it must
      // be matched before any broader 'guild_wars' substring check).
      if (text.includes('SELECT g.id FROM guilds g')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await findWarOpponent('guild-a', mockDb);
    expect(result).toBeNull();
  });

  it('returns an opponent guild within ±15% XP range', async () => {
    const selfXP = 10000;

    mockQuery.mockImplementation((text: string) => {
      if (text.includes('SELECT id, guild_xp, city FROM guilds')) {
        return Promise.resolve({ rows: [{ id: 'guild-a', guild_xp: selfXP, city: null }], rowCount: 1 });
      }
      if (text.includes('SELECT g.id FROM guilds g')) {
        return Promise.resolve({ rows: [{ id: 'guild-b' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await findWarOpponent('guild-a', mockDb);
    expect(result).toBe('guild-b');
  });

  it('does not return the declaring guild as its own opponent', async () => {
    // Self-exclusion happens SQL-side via `g.id != $N` (N = 1, the first
    // interpolation in the candidate query) rather than post-filtering in JS.
    let candidateSql: string | undefined;
    let candidateParams: unknown[] | undefined;
    mockQuery.mockImplementation((text: string, params?: unknown[]) => {
      if (text.includes('SELECT id, guild_xp, city FROM guilds')) {
        return Promise.resolve({ rows: [{ id: 'guild-a', guild_xp: 5000, city: null }], rowCount: 1 });
      }
      if (text.includes('SELECT g.id FROM guilds g')) {
        candidateSql = text;
        candidateParams = params;
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await findWarOpponent('guild-a', mockDb);
    expect(result).toBeNull();
    expect(candidateSql).toContain('g.id !=');
    // No city on self, so params = [guildId, minXP, maxXP, cooldownHours, selfXP]
    expect(candidateParams?.[0]).toBe('guild-a');
  });

  it('does not return a guild that is currently at war', async () => {
    // The busy-guild exclusion (guilds with an active/final-hour war) is a
    // NOT EXISTS subquery baked into the candidate SQL itself, not a
    // separate query or JS-side filter — assert the subquery is present.
    let candidateSql: string | undefined;
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('SELECT id, guild_xp, city FROM guilds')) {
        return Promise.resolve({ rows: [{ id: 'guild-a', guild_xp: 5000, city: null }], rowCount: 1 });
      }
      if (text.includes('SELECT g.id FROM guilds g')) {
        candidateSql = text;
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await findWarOpponent('guild-a', mockDb);
    expect(result).toBeNull();
    expect(candidateSql).toContain('NOT EXISTS');
    expect(candidateSql).toMatch(/guild_wars[\s\S]*status IN \('active', 'final_hour'\)/);
  });
});

// ---------------------------------------------------------------------------
// resolveWar
// ---------------------------------------------------------------------------

describe('resolveWar', () => {
  it('throws when war is not found', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(resolveWar('nonexistent-war', mockDb)).rejects.toThrow('War not found');
  });

  it('throws when war is already completed', async () => {
    // The war row is claimed via an atomic `UPDATE ... RETURNING *`
    // (BUG-071/ZB-07 idempotency fix); the RETURNING row itself carries the
    // war's current status, so returning a 'completed' row here is enough
    // to exercise the already-resolved guard.
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('UPDATE guild_wars') && text.includes('RETURNING')) {
        return Promise.resolve({
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
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    await expect(resolveWar('war-1', mockDb)).rejects.toThrow('already resolved');
  });

  it('throws when war is cancelled', async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('UPDATE guild_wars') && text.includes('RETURNING')) {
        return Promise.resolve({
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
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
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

    mockQuery.mockImplementation((text: string) => {
      if (text.includes('UPDATE guild_wars') && text.includes('RETURNING')) {
        return Promise.resolve({ rows: [warRow], rowCount: 1 });
      }
      if (text.includes('FROM guild_members gm')) {
        return Promise.resolve({ rows: [{ user_id: 'member-1', war_points: 0 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
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

    mockQuery.mockImplementation((text: string) => {
      if (text.includes('UPDATE guild_wars') && text.includes('RETURNING')) {
        return Promise.resolve({ rows: [warRow], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
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

    mockQuery.mockImplementation((text: string) => {
      if (text.includes('UPDATE guild_wars') && text.includes('RETURNING')) {
        return Promise.resolve({ rows: [warRow], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
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
  it('does nothing when there are no member contributions', async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('SELECT wc.user_id')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    // Should not throw
    await expect(distributeWarRewards('war-1', 'guild-a', mockDb)).resolves.toBeUndefined();
    expect(mockCreditCoins).not.toHaveBeenCalled();
  });

  it('allocates 30% of the pool to the top contributor', async () => {
    const POOL = 2000;
    const expectedTopShare = Math.floor(POOL * 0.3); // 600

    const members = [
      { user_id: 'user-1', guild_id: 'guild-a', war_points: 1000, username: 'alice' },
      { user_id: 'user-2', guild_id: 'guild-a', war_points: 500, username: 'bob' },
      { user_id: 'user-3', guild_id: 'guild-a', war_points: 200, username: 'charlie' },
    ];

    mockQuery.mockImplementation((text: string) => {
      if (text.includes('SELECT wc.user_id')) {
        return Promise.resolve({ rows: members, rowCount: members.length });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await distributeWarRewards('war-1', 'guild-a', mockDb);

    const call = mockCreditCoins.mock.calls.find((c) => c[0] === 'user-1');
    expect(call).toBeDefined();
    expect(call![1]).toBe(expectedTopShare);
    expect(call![2]).toBe('war_reward');
  });

  it('allocates 20% of the pool to the second contributor', async () => {
    const POOL = 2000;
    const expectedSecondShare = Math.floor(POOL * 0.2); // 400

    const members = [
      { user_id: 'user-1', guild_id: 'guild-a', war_points: 1000, username: 'alice' },
      { user_id: 'user-2', guild_id: 'guild-a', war_points: 500, username: 'bob' },
    ];

    mockQuery.mockImplementation((text: string) => {
      if (text.includes('SELECT wc.user_id')) {
        return Promise.resolve({ rows: members, rowCount: members.length });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await distributeWarRewards('war-1', 'guild-a', mockDb);

    const call = mockCreditCoins.mock.calls.find((c) => c[0] === 'user-2');
    expect(call).toBeDefined();
    expect(call![1]).toBe(expectedSecondShare);
  });

  it('queues top contributor bonus XP for rank-1 member', async () => {
    const members = [
      { user_id: 'user-1', guild_id: 'guild-a', war_points: 999, username: 'alice' },
    ];

    mockQuery.mockImplementation((text: string) => {
      if (text.includes('SELECT wc.user_id')) {
        return Promise.resolve({ rows: members, rowCount: members.length });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    // distributeWarRewards defers XP awards via pendingXPAwards so the caller
    // (resolveWar) can issue them post-commit, avoiding phantom DLQ entries.
    const pendingXPAwards: Array<{ userId: string; amount: number; track: "competitor"; source: string; ref: string }> = [];
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
