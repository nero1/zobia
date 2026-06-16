/**
 * Unit tests for coin economy operations.
 *
 * The database is fully mocked — no real DB connection is made.
 * Each test verifies the contract of creditCoins, debitCoins, transferCoins,
 * canAfford, and getBalance independently.
 */

// ---------------------------------------------------------------------------
// Mock @/lib/db before any import that transitively uses it
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

// ---------------------------------------------------------------------------
// Imports — must come after jest.mock calls
// ---------------------------------------------------------------------------

import {
  creditCoins,
  debitCoins,
  transferCoins,
  canAfford,
  getBalance,
} from '@/lib/economy/coins';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock TransactionClient that records every query call.
 * Responses can be overridden per test by mutating `balanceRows`.
 */
function buildMockTxClient(initialBalance = 1000) {
  let callCount = 0;
  // Tracks every [sql, params] pair passed to tx.query
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const txClient = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      // First SELECT (lockAndGetBalance) returns the balance
      if (sql.includes('SELECT coin_balance FROM users') && sql.includes('FOR UPDATE')) {
        return { rows: [{ coin_balance: String(initialBalance) }], rowCount: 1 };
      }
      // INSERT ... RETURNING * (writeLedgerEntry creates and returns the row in one query)
      if (sql.includes('INSERT INTO coin_ledger')) {
        const mockEntry = {
          id: 'ledger-entry-id',
          user_id: params[0],
          amount: params[1],
          balance_before: params[2],
          balance_after: params[3],
          transaction_type: params[4],
          reference_id: params[5] ?? null,
          description: params[6] ?? null,
          metadata: params[7] ?? null,
          created_at: new Date().toISOString(),
        };
        return { rows: [mockEntry], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    queries,
  };
  return txClient;
}

/**
 * Wire up mockTransaction so that it immediately invokes the callback
 * with the provided txClient.
 */
function setupTransaction(txClient: ReturnType<typeof buildMockTxClient>) {
  mockTransaction.mockImplementation(async (fn: (tx: typeof txClient) => Promise<unknown>) => {
    return fn(txClient);
  });
}

// ---------------------------------------------------------------------------
// creditCoins
// ---------------------------------------------------------------------------

describe('creditCoins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('credits a positive integer amount successfully', async () => {
    const txClient = buildMockTxClient(500);
    setupTransaction(txClient);

    const entry = await creditCoins('user-1', 100, 'quest_reward');
    expect(entry).toBeDefined();
    // Verify an INSERT to coin_ledger was made
    const insertCall = txClient.queries.find((q) => q.sql.includes('INSERT INTO coin_ledger'));
    expect(insertCall).toBeDefined();
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
    const txClient = buildMockTxClient(0);
    setupTransaction(txClient);

    await creditCoins('user-2', 250, 'purchase', 'ref-abc', 'Test credit');
    const insertCall = txClient.queries.find((q) => q.sql.includes('INSERT INTO coin_ledger'));
    expect(insertCall).toBeDefined();
  });

  it('updates user coin_balance', async () => {
    const txClient = buildMockTxClient(200);
    setupTransaction(txClient);

    await creditCoins('user-3', 50, 'admin_grant');
    const updateCall = txClient.queries.find((q) => q.sql.includes('UPDATE users SET coin_balance'));
    expect(updateCall).toBeDefined();
  });

  it('uses the provided txClient when passed', async () => {
    const txClient = buildMockTxClient(100);
    // When txClient is passed, db.transaction should NOT be called
    await creditCoins('user-4', 10, 'quest_reward', null, null, null, txClient as any);
    expect(mockTransaction).not.toHaveBeenCalled();
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
    const txClient = buildMockTxClient(1000);
    setupTransaction(txClient);

    const entry = await debitCoins('user-1', 100, 'gift_sent');
    expect(entry).toBeDefined();
  });

  it('throws INSUFFICIENT_BALANCE when balance is too low', async () => {
    const txClient = buildMockTxClient(50); // only 50 coins
    setupTransaction(txClient);

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
    const txClient = buildMockTxClient(500);
    setupTransaction(txClient);

    await debitCoins('user-1', 100, 'dm_cost');
    const insertCall = txClient.queries.find((q) => q.sql.includes('INSERT INTO coin_ledger'));
    expect(insertCall).toBeDefined();
    // The negated amount is passed as the second parameter (as a string — Decimal.toFixed(0))
    const params = insertCall!.params as string[];
    // params[1] is the amount passed to writeLedgerEntry — it should be "-100"
    expect(params[1]).toBe('-100');
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
    mockQuery.mockResolvedValueOnce({ rows: [{ coin_balance: '750' }], rowCount: 1 });
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
    mockQuery.mockResolvedValueOnce({ rows: [{ coin_balance: '100' }], rowCount: 1 });
    expect(await canAfford('user-1', 100)).toBe(true);
  });

  it('returns true when balance exceeds the amount', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ coin_balance: '500' }], rowCount: 1 });
    expect(await canAfford('user-1', 100)).toBe(true);
  });

  it('returns false when balance is less than the amount', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ coin_balance: '50' }], rowCount: 1 });
    expect(await canAfford('user-1', 200)).toBe(false);
  });

  it('returns false for zero balance', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ coin_balance: '0' }], rowCount: 1 });
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

  /**
   * Build a tx client that tracks two users' balances in sequence.
   * First lockAndGetBalance call → senderBalance
   * Second lockAndGetBalance call → receiverBalance
   */
  function buildDualUserTxClient(senderBalance: number, receiverBalance: number) {
    let lockCallCount = 0;
    const queries: Array<{ sql: string; params: unknown[] }> = [];

    const txClient = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });

        if (sql.includes('SELECT coin_balance FROM users') && sql.includes('FOR UPDATE')) {
          lockCallCount++;
          const bal = lockCallCount === 1 ? senderBalance : receiverBalance;
          return { rows: [{ coin_balance: String(bal) }], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO coin_ledger')) {
          const mockEntry = {
            id: `ledger-${lockCallCount}`,
            user_id: params[0],
            amount: params[1],
            balance_before: params[2],
            balance_after: params[3],
            transaction_type: params[4],
            reference_id: params[5] ?? null,
            description: params[6] ?? null,
            metadata: params[7] ?? null,
            created_at: new Date().toISOString(),
          };
          return { rows: [mockEntry], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }),
      queries,
    };

    return txClient;
  }

  it('deducts from sender and credits receiver with 5% fee', async () => {
    const txClient = buildDualUserTxClient(1000, 200);

    // transferCoins wraps in a transaction internally, then calls debit/credit
    // which each try to start their own transaction. We need to chain them.
    let callCount = 0;
    mockTransaction.mockImplementation(async (fn: (tx: typeof txClient) => Promise<unknown>) => {
      callCount++;
      return fn(txClient);
    });

    const result = await transferCoins('sender-1', 'receiver-1', 100, 'idem-ref-1');

    // 5% of 100 = 5 coins fee, net = 95 coins to receiver
    expect(result.feeCoins).toBe(5);
    expect(result.debit).toBeDefined();
    expect(result.credit).toBeDefined();
  });

  it('throws INSUFFICIENT_BALANCE when sender cannot afford gross amount', async () => {
    const txClient = buildDualUserTxClient(10, 200); // sender only has 10 coins
    mockTransaction.mockImplementation(async (fn: (tx: typeof txClient) => Promise<unknown>) => {
      return fn(txClient);
    });

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
    const txClient = buildDualUserTxClient(1000, 0);
    mockTransaction.mockImplementation(async (fn: (tx: typeof txClient) => Promise<unknown>) => {
      return fn(txClient);
    });

    const result = await transferCoins('sender-1', 'receiver-1', 200, 'idem-ref-4', 10);
    // 10% of 200 = 20 coins fee
    expect(result.feeCoins).toBe(20);
  });
});
