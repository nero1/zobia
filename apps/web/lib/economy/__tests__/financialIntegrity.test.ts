/**
 * Financial integrity integration-style tests.
 *
 * These tests verify the invariants of the coin and star ledger systems:
 *  - Credit + debit returns balance to original value
 *  - Transfer math is correct (fee applied, net credited)
 *  - Ledger entries are never UPDATE'd (append-only)
 *  - All amounts are integers (no floating point)
 *  - Concurrent (sequential in tests) credits don't lose data
 *
 * lib/economy/{coins,stars}.ts have been migrated to Drizzle ORM (getDb() /
 * orm.transaction() / the query builder) instead of the raw `@/lib/db`
 * adapter. Rather than hand-mock every `.select()/.insert()/.update()`
 * chain shape (which would silently drift from what Drizzle actually
 * compiles), these tests back a *real* `drizzle-orm/node-postgres`
 * instance with a fake `pg`-shaped client whose `query()` is a jest.fn.
 * Every query issued still goes through real Drizzle query compilation —
 * exactly like production — and lands on `mockQuery` as plain SQL text +
 * params, which tests dispatch on (see
 * lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
 */

// ---------------------------------------------------------------------------
// Build a real Drizzle instance backed by a mock client, then mock
// @/lib/db/drizzle's getDb() to return it.
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

const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

jest.mock("@/lib/db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { creditCoins, debitCoins, transferCoins } from "@/lib/economy/coins";
import { creditStars, debitStars } from "@/lib/economy/stars";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wires `mockQuery` to simulate the `users.coin_balance` column and the
 * append-only `coin_ledger` table for one or more users, keyed by userId.
 * Rows are returned in Drizzle's "array" row mode (positional, matching the
 * selected/returned column order), which is what the node-postgres driver
 * adapter uses whenever `fields` are known — i.e. every query built through
 * the query builder, as opposed to a raw `sql\`...\`` escape hatch.
 */
function installCoinsMock(initialBalances: Record<string, number>) {
  const balances: Record<string, number> = { ...initialBalances };
  const queriesSeen: string[] = [];

  mockQuery.mockImplementation(async (text: string, params: unknown[] = []) => {
    queriesSeen.push(text);

    if (text.startsWith('insert into "coin_ledger"')) {
      const [userId, amount, balanceBefore, balanceAfter, transactionType, referenceId, description, metadata] =
        params;
      return {
        rows: [
          [
            "ledger-entry-id",
            userId,
            amount,
            balanceBefore,
            balanceAfter,
            transactionType,
            referenceId ?? null,
            description ?? null,
            metadata ?? null,
            new Date(),
          ],
        ],
        rowCount: 1,
      };
    }

    if (text.startsWith("select") && text.includes('"coin_balance"')) {
      const userId = params[0] as string;
      return { rows: [[String(balances[userId] ?? 0)]], rowCount: 1 };
    }

    if (text.startsWith("select") && text.includes('from "coin_ledger"')) {
      return { rows: [], rowCount: 0 };
    }

    if (text.startsWith("select") && text.includes('from "users"')) {
      // transferCoins' generic deadlock pre-lock ("SELECT id FROM users ... FOR UPDATE")
      return { rows: [[params[0]]], rowCount: 1 };
    }

    if (text.startsWith('update "users"') && text.includes('"coin_balance"')) {
      const userId = params[2] as string;
      balances[userId] = Number(params[0]);
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });

  return { balances, queriesSeen };
}

/**
 * Same idea as `installCoinsMock`, but for `users.star_balance` /
 * `star_ledger`. Note star_ledger's physical column order is
 * (..., transaction_type, description, reference_id, created_at) — the
 * reverse of coin_ledger's (..., transaction_type, reference_id,
 * description, ...) — because Drizzle always compiles INSERT/RETURNING
 * column lists in the *table's* column definition order, not the
 * `.values({...})` object's key order.
 */
function installStarsMock(initialBalances: Record<string, number>) {
  const balances: Record<string, number> = { ...initialBalances };
  const queriesSeen: string[] = [];

  mockQuery.mockImplementation(async (text: string, params: unknown[] = []) => {
    queriesSeen.push(text);

    if (text.startsWith('insert into "star_ledger"')) {
      const [userId, amount, balanceBefore, balanceAfter, transactionType, description, referenceId] = params;
      return {
        rows: [
          [
            "star-ledger-entry-id",
            userId,
            amount,
            balanceBefore,
            balanceAfter,
            transactionType,
            description ?? null,
            referenceId ?? null,
            new Date(),
          ],
        ],
        rowCount: 1,
      };
    }

    if (text.startsWith("select") && text.includes('"star_balance"')) {
      const userId = params[0] as string;
      return { rows: [[String(balances[userId] ?? 0)]], rowCount: 1 };
    }

    if (text.startsWith("select") && text.includes('from "star_ledger"')) {
      return { rows: [], rowCount: 0 };
    }

    if (text.startsWith('update "users"') && text.includes('"star_balance"')) {
      const userId = params[2] as string;
      balances[userId] = Number(params[0]);
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });

  return { balances, queriesSeen };
}

// ---------------------------------------------------------------------------
// Credit + Debit leaves balance unchanged
// ---------------------------------------------------------------------------

describe('Credit + Debit balance invariant', () => {
  beforeEach(() => jest.clearAllMocks());

  it('coin balance returns to original value after equal credit and debit', async () => {
    const INITIAL = 1000;
    const AMOUNT = 250;

    const { balances } = installCoinsMock({ 'user-1': INITIAL });

    await creditCoins('user-1', AMOUNT, 'quest_reward');
    expect(balances['user-1']).toBe(INITIAL + AMOUNT);

    await debitCoins('user-1', AMOUNT, 'gift_sent');
    expect(balances['user-1']).toBe(INITIAL);
  });

  it('star balance returns to original value after equal credit and debit', async () => {
    const INITIAL = 500;
    const AMOUNT = 100;

    const { balances } = installStarsMock({ 'user-1': INITIAL });

    await creditStars('user-1', AMOUNT, 'quest_reward');
    expect(balances['user-1']).toBe(INITIAL + AMOUNT);

    await debitStars('user-1', AMOUNT, 'gift_sent');
    expect(balances['user-1']).toBe(INITIAL);
  });
});

// ---------------------------------------------------------------------------
// Transfer: sender decreases, receiver increases by net
// ---------------------------------------------------------------------------

describe('Transfer math invariant', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sender balance decreases by gross amount', async () => {
    const SENDER_INITIAL = 1000;
    const AMOUNT = 200;
    const FEE = 5; // 5%
    const NET = AMOUNT - Math.floor((AMOUNT * FEE) / 100); // 190

    const { balances } = installCoinsMock({ 'sender-1': SENDER_INITIAL, 'receiver-1': 0 });

    await transferCoins('sender-1', 'receiver-1', AMOUNT, 'idem-ref-1', FEE);

    expect(balances['sender-1']).toBe(SENDER_INITIAL - AMOUNT);
    expect(balances['receiver-1']).toBe(NET);
  });

  it('feeCoins is correctly calculated as floor(amount * feePercent / 100)', async () => {
    // 7% of 100 = 7 coins
    installCoinsMock({ 'sender-1': 1000, 'receiver-1': 0 });

    const result = await transferCoins('sender-1', 'receiver-1', 100, 'idem-ref-2', 7);
    expect(result.feeCoins).toBe(7); // floor(100 * 7 / 100)
  });
});

// ---------------------------------------------------------------------------
// Ledger immutability — no UPDATE on ledger tables
// ---------------------------------------------------------------------------

describe('Ledger immutability', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creditCoins never issues UPDATE on coin_ledger', async () => {
    const { queriesSeen } = installCoinsMock({ 'user-1': 100 });

    await creditCoins('user-1', 50, 'quest_reward');

    const updateOnLedger = queriesSeen.find(
      (sql) => sql.trim().toLowerCase().startsWith('update') && sql.toLowerCase().includes('coin_ledger')
    );
    expect(updateOnLedger).toBeUndefined();
  });

  it('debitCoins never issues UPDATE on coin_ledger', async () => {
    const { queriesSeen } = installCoinsMock({ 'user-1': 500 });

    await debitCoins('user-1', 100, 'gift_sent');

    const updateOnLedger = queriesSeen.find(
      (sql) => sql.trim().toLowerCase().startsWith('update') && sql.toLowerCase().includes('coin_ledger')
    );
    expect(updateOnLedger).toBeUndefined();
  });

  it('creditStars never issues UPDATE on star_ledger', async () => {
    const { queriesSeen } = installStarsMock({ 'user-1': 50 });

    await creditStars('user-1', 10, 'quest_reward');

    const updateOnStarLedger = queriesSeen.find(
      (sql) => sql.trim().toLowerCase().startsWith('update') && sql.toLowerCase().includes('star_ledger')
    );
    expect(updateOnStarLedger).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// All amounts are integers
// ---------------------------------------------------------------------------

describe('Integer-only amounts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creditCoins rejects float amounts', async () => {
    await expect(creditCoins('user-1', 9.99, 'quest_reward')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('debitCoins rejects float amounts', async () => {
    await expect(debitCoins('user-1', 0.5, 'gift_sent')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('creditStars rejects float amounts', async () => {
    await expect(creditStars('user-1', 1.1, 'purchase')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('debitStars rejects float amounts', async () => {
    await expect(debitStars('user-1', 3.14, 'gift_sent')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('transferCoins rejects float amounts', async () => {
    await expect(transferCoins('sender-1', 'receiver-1', 99.9, 'idem-ref-3')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('creditCoins rejects amount = 0', async () => {
    await expect(creditCoins('user-1', 0, 'quest_reward')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('creditCoins accepts whole integer amounts', async () => {
    // Validation happens before any DB access. Deliberately leave the DB
    // mock unconfigured (mockQuery resolves to `undefined` by default) so
    // that any error thrown past the validation step is *not* mistaken for
    // a validation failure — confirming validation itself passed for every
    // one of these amounts.
    const validAmounts = [1, 10, 100, 1000, 99999];
    for (const amount of validAmounts) {
      try {
        await creditCoins('user-1', amount, 'quest_reward');
      } catch (err) {
        // Should not be a validation error
        expect((err as Error).message).not.toContain('amount must be a positive integer');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Sequential credits don't lose data
// ---------------------------------------------------------------------------

describe('Concurrent (sequential) credits preserve all ledger entries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('three sequential credits each produce a separate ledger entry', async () => {
    const insertedEntries: unknown[][] = [];
    const { balances } = installCoinsMock({ 'u1': 0 });

    // Wrap installCoinsMock's implementation to also record every coin_ledger insert.
    const baseImpl = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (text: string, params: unknown[] = []) => {
      if (text.startsWith('insert into "coin_ledger"')) {
        insertedEntries.push([...params]);
      }
      return baseImpl(text, params);
    });

    // Execute three sequential credits
    await creditCoins('u1', 100, 'quest_reward');
    await creditCoins('u1', 200, 'daily_login');
    await creditCoins('u1', 50, 'purchase');

    // Each credit should have produced exactly one INSERT on coin_ledger
    expect(insertedEntries.length).toBe(3);

    // Final balance should be 100 + 200 + 50 = 350
    expect(balances['u1']).toBe(350);
  });
});
