/**
 * Unit tests for coin economy operations.
 *
 * lib/economy/coins.ts has been migrated to Drizzle ORM (getDb() /
 * orm.transaction() / the query builder) instead of the raw `@/lib/db`
 * adapter. Rather than hand-mock every `.select()/.insert()/.update()`
 * chain shape (which would silently drift from what Drizzle actually
 * compiles), these tests back a *real* `drizzle-orm/node-postgres`
 * instance with a fake `pg`-shaped client whose `query()` is a jest.fn.
 * Every query coins.ts issues still goes through real Drizzle query
 * compilation — exactly like production — and lands on `mockQuery` as
 * plain SQL text + params, which tests dispatch on (see
 * lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
 *
 * The database is fully mocked — no real DB connection is made.
 * Each test verifies the contract of creditCoins, debitCoins, transferCoins,
 * canAfford, and getBalance independently.
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

// coins.ts does not import `@/lib/db` (the raw adapter) directly, but keep
// this mocked defensively so no test accidentally opens a real connection.
jest.mock("@/lib/db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Imports — must come after jest.mock calls
// ---------------------------------------------------------------------------

import {
  creditCoins,
  debitCoins,
  transferCoins,
  canAfford,
  getBalance,
} from "@/lib/economy/coins";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wires `mockQuery` to simulate the users/coin_ledger tables for one or more
 * users, keyed by userId. Handles:
 *  - `select "coin_balance" from "users" ... [for update]`
 *  - `select "id" from "users" ... for update` (transferCoins deadlock pre-lock)
 *  - `insert into "coin_ledger" ... on conflict ... returning ...`
 *  - `select ... from "coin_ledger" ...` (dedup / duplicate lookup — no-op by default)
 *  - `update "users" set "coin_balance" = $1, "updated_at" = $2 where ...`
 *
 * Rows are returned in Drizzle's "array" row mode (positional, matching the
 * selected/returned column order) since that's what the node-postgres driver
 * adapter requests whenever `fields` are known (i.e. every query built
 * through the query builder, as opposed to a raw `sql\`...\`` escape hatch).
 */
function installCoinsMock(initialBalances: Record<string, number>) {
  const balances: Record<string, number> = { ...initialBalances };
  const insertedParams: unknown[][] = [];

  mockQuery.mockImplementation(async (text: string, params: unknown[] = []) => {
    if (text.startsWith("insert into \"coin_ledger\"")) {
      insertedParams.push([...params]);
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
      // findExistingLedgerEntry / duplicate lookup — no existing row by default.
      return { rows: [], rowCount: 0 };
    }

    if (text.startsWith("select") && text.includes('from "users"')) {
      // transferCoins' generic "SELECT id FROM users ... FOR UPDATE" deadlock
      // pre-lock — the returned id is never inspected.
      return { rows: [[params[0]]], rowCount: 1 };
    }

    if (text.startsWith('update "users"') && text.includes('"coin_balance"')) {
      const userId = params[2] as string;
      balances[userId] = Number(params[0]);
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });

  return { balances, insertedParams };
}

// ---------------------------------------------------------------------------
// creditCoins
// ---------------------------------------------------------------------------

describe('creditCoins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('credits a positive integer amount successfully', async () => {
    const { insertedParams } = installCoinsMock({ 'user-1': 500 });

    const entry = await creditCoins('user-1', 100, 'quest_reward');
    expect(entry).toBeDefined();
    // Verify an INSERT to coin_ledger was made
    expect(insertedParams.length).toBe(1);
  });

  it('throws when amount is negative', async () => {
    await expect(creditCoins('user-1', -50, 'quest_reward')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('throws when amount is zero', async () => {
    await expect(creditCoins('user-1', 0, 'quest_reward')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('throws when amount is a non-integer (float)', async () => {
    await expect(creditCoins('user-1', 9.99, 'quest_reward')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('writes a ledger entry (INSERT INTO coin_ledger)', async () => {
    const { insertedParams } = installCoinsMock({ 'user-2': 0 });

    await creditCoins('user-2', 250, 'purchase', 'ref-abc', 'Test credit');
    expect(insertedParams.length).toBe(1);
  });

  it('updates user coin_balance', async () => {
    const { balances } = installCoinsMock({ 'user-3': 200 });

    await creditCoins('user-3', 50, 'admin_grant');
    expect(balances['user-3']).toBe(250);
  });

  it('uses the provided txClient when passed', async () => {
    installCoinsMock({ 'user-4': 100 });
    // When txClient is passed, getDb().transaction() should NOT be invoked —
    // i.e. no "begin" statement is ever issued.
    await creditCoins('user-4', 10, 'quest_reward', null, null, null, mockDb);
    const beganTransaction = mockQuery.mock.calls.some(([text]) => text === 'begin');
    expect(beganTransaction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// debitCoins
// ---------------------------------------------------------------------------

describe('debitCoins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('debits successfully when balance is sufficient', async () => {
    installCoinsMock({ 'user-1': 1000 });

    const entry = await debitCoins('user-1', 100, 'gift_sent');
    expect(entry).toBeDefined();
  });

  it('throws INSUFFICIENT_BALANCE when balance is too low', async () => {
    installCoinsMock({ 'user-1': 50 }); // only 50 coins

    await expect(debitCoins('user-1', 200, 'gift_sent')).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
  });

  it('throws when amount is negative', async () => {
    await expect(debitCoins('user-1', -10, 'gift_sent')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('throws when amount is non-integer', async () => {
    await expect(debitCoins('user-1', 1.5, 'gift_sent')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('stores a negative amount in the ledger entry for debits', async () => {
    const { insertedParams } = installCoinsMock({ 'user-1': 500 });

    await debitCoins('user-1', 100, 'dm_cost');
    expect(insertedParams.length).toBe(1);
    // params[1] is the `amount` value bound to the coin_ledger insert. It is
    // a genuine BigInt (Drizzle's bigint("...", { mode: "bigint" }) columns
    // pass their driver value through unchanged — see
    // lib/seasons/__tests__/seasonEngine.test.ts's `expect(params[0]).toBe(0n)`
    // for the same pattern), not a stringified Decimal like the old raw-SQL
    // adapter produced.
    const params = insertedParams[0];
    expect(params[1]).toBe(-100n);
  });
});

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

describe('getBalance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the current balance for a user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [['750']], rowCount: 1 });
    const balance = await getBalance('user-1');
    expect(balance).toBe(750);
  });

  it('throws when user is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(getBalance('missing-user')).rejects.toThrow('User not found');
  });
});

// ---------------------------------------------------------------------------
// canAfford
// ---------------------------------------------------------------------------

describe('canAfford', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when balance equals the amount', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [['100']], rowCount: 1 });
    expect(await canAfford('user-1', 100)).toBe(true);
  });

  it('returns true when balance exceeds the amount', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [['500']], rowCount: 1 });
    expect(await canAfford('user-1', 100)).toBe(true);
  });

  it('returns false when balance is less than the amount', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [['50']], rowCount: 1 });
    expect(await canAfford('user-1', 200)).toBe(false);
  });

  it('returns false for zero balance', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [['0']], rowCount: 1 });
    expect(await canAfford('user-1', 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// transferCoins
// ---------------------------------------------------------------------------

describe('transferCoins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deducts from sender and credits receiver with 5% fee', async () => {
    const { balances } = installCoinsMock({ 'sender-1': 1000, 'receiver-1': 200 });

    const result = await transferCoins('sender-1', 'receiver-1', 100, 'idem-ref-1');

    // 5% of 100 = 5 coins fee, net = 95 coins to receiver
    expect(result.feeCoins).toBe(5);
    expect(result.debit).toBeDefined();
    expect(result.credit).toBeDefined();
    expect(balances['sender-1']).toBe(900);
    expect(balances['receiver-1']).toBe(295);
  });

  it('throws INSUFFICIENT_BALANCE when sender cannot afford gross amount', async () => {
    installCoinsMock({ 'sender-1': 10, 'receiver-1': 200 }); // sender only has 10 coins

    await expect(transferCoins('sender-1', 'receiver-1', 100, 'idem-ref-2')).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
  });

  it('throws when transfer amount is non-integer', async () => {
    await expect(transferCoins('sender-1', 'receiver-1', 9.5, 'idem-ref-3')).rejects.toThrow(
      'amount must be a positive integer'
    );
  });

  it('computes fee correctly for 10% fee', async () => {
    installCoinsMock({ 'sender-1': 1000, 'receiver-1': 0 });

    const result = await transferCoins('sender-1', 'receiver-1', 200, 'idem-ref-4', 10);
    // 10% of 200 = 20 coins fee
    expect(result.feeCoins).toBe(20);
  });
});
