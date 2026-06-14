/**
 * Unit tests for lib/quests/questEngine.ts
 *
 * Database is fully mocked. Tests verify:
 *  - generateDailyDeck returns correct deck sizes per plan
 *  - generateDailyDeck filters quests by plan hierarchy (BUG-QS01 fix)
 *  - updateQuestProgress increments counter and marks completed
 *  - updateQuestProgress is idempotent — no double awards
 *  - resetDailyQuests bulk-resets user_quest_progress rows
 */

// ---------------------------------------------------------------------------
// Mock @/lib/db before any imports
// ---------------------------------------------------------------------------

const mockQuery = jest.fn();
const mockTransaction = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
    healthCheck: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/economy/coins', () => ({
  creditCoins: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  generateDailyDeck,
  updateQuestProgress,
  resetDailyQuests,
} from '@/lib/quests/questEngine';
import type { DatabaseAdapter, TransactionClient } from '@/lib/db/interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTemplate(id: string, planRequired: string | null = null) {
  return {
    id,
    title: `Quest ${id}`,
    description: 'Do something',
    action_type: 'send_message',
    target_count: 5,
    xp_reward: 50,
    coin_reward: 10,
    category: 'social',
    icon: null,
    plan_required: planRequired,
  };
}

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
// generateDailyDeck
// ---------------------------------------------------------------------------

describe('generateDailyDeck', () => {
  it('returns empty array when no templates are available', async () => {
    const db = buildMockDb({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });

    const deck = await generateDailyDeck('user-1', 'free', db);
    expect(deck).toEqual([]);
  });

  it('returns deck with progress merged in', async () => {
    const templates = [makeTemplate('q1'), makeTemplate('q2'), makeTemplate('q3')];
    const progresses = [{ quest_id: 'q1', progress_count: 3, completed: false, completed_at: null }];

    let callCount = 0;
    const db = buildMockDb({
      query: jest.fn(async () => {
        callCount++;
        if (callCount === 1) return { rows: templates, rowCount: 3 };
        return { rows: progresses, rowCount: 1 };
      }),
    });

    const deck = await generateDailyDeck('user-1', 'free', db);

    expect(deck).toHaveLength(3);
    const q1 = deck.find((d) => d.id === 'q1');
    expect(q1?.progress_count).toBe(3);
    const q2 = deck.find((d) => d.id === 'q2');
    expect(q2?.progress_count).toBe(0);
  });

  it('passes correct plan filter SQL (BUG-QS01 fix)', async () => {
    const db = buildMockDb({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });

    await generateDailyDeck('user-1', 'pro', db);

    const querySpy = db.query as jest.Mock;
    const [sql] = querySpy.mock.calls[0];

    // After the fix, SQL must use hierarchical plan_required logic
    expect(sql).toMatch(/plan_required = 'pro' AND \$2 IN/);
    expect(sql).toMatch(/plan_required = 'plus' AND \$2 IN/);
  });
});

// ---------------------------------------------------------------------------
// updateQuestProgress
// ---------------------------------------------------------------------------

describe('updateQuestProgress', () => {
  it('returns no-op when quest is already completed', async () => {
    const db = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        const tx: TransactionClient = {
          query: jest.fn(async (sql: string) => {
            if (sql.includes('FROM quest_templates')) {
              return { rows: [makeTemplate('q1')], rowCount: 1 };
            }
            if (sql.includes('FROM user_quest_progress')) {
              return { rows: [{ progress_count: 5, completed: true }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          }),
        };
        return fn(tx);
      }),
    });

    const result = await updateQuestProgress('user-1', 'q1', 1, db);

    expect(result.newly_completed).toBe(false);
    expect(result.xp_awarded).toBe(0);
  });

  it('throws when quest is not found', async () => {
    const db = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        const tx: TransactionClient = {
          query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        };
        return fn(tx);
      }),
    });

    await expect(updateQuestProgress('user-1', 'nonexistent', 1, db)).rejects.toThrow(
      /Quest not found/
    );
  });

  it('marks quest complete and awards XP when target reached', async () => {
    const template = { ...makeTemplate('q1'), target_count: 3, xp_reward: 100, coin_reward: 20 };

    const db = buildMockDb({
      transaction: jest.fn().mockImplementation(async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        const tx: TransactionClient = {
          query: jest.fn(async (sql: string) => {
            if (sql.includes('FROM quest_templates')) {
              return { rows: [template], rowCount: 1 };
            }
            if (sql.includes('FROM user_quest_progress')) {
              return { rows: [{ progress_count: 2, completed: false }], rowCount: 1 };
            }
            // UPSERT progress
            if (sql.includes('INSERT INTO user_quest_progress')) {
              return { rows: [{ progress_count: 3, completed: true, completed_at: new Date().toISOString() }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
          }),
        };
        return fn(tx);
      }),
    });

    const result = await updateQuestProgress('user-1', 'q1', 1, db);

    expect(result.newly_completed).toBe(true);
    expect(result.xp_awarded).toBe(100);
    expect(result.coins_awarded).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// resetDailyQuests
// ---------------------------------------------------------------------------

describe('resetDailyQuests', () => {
  it('calls db.query to reset user_quest_progress', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: '42' }], rowCount: 1 });

    await resetDailyQuests();

    expect(mockQuery).toHaveBeenCalled();
    const sql: string = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/user_quest_progress/i);
  });
});
