/**
 * Financial integrity integration-style tests.
 *
 * These tests verify the invariants of the coin and star ledger systems:
 *  - Credit + debit returns balance to original value
 *  - Transfer math is correct (fee applied, net credited)
 *  - Ledger entries are never UPDATE'd (append-only)
 *  - All amounts are integers (no floating point)
 *  - Concurrent (sequential in tests) credits don't lose data
 */

// ---------------------------------------------------------------------------
// Mock @/lib/db
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
// Imports
// ---------------------------------------------------------------------------

import { creditCoins, debitCoins, transferCoins } from '@/lib/economy/coins';
import { creditStars, debitStars } from '@/lib/economy/stars';
import type { TransactionClient } from '@/lib/db/interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LedgerEntry {
  id: string;
  user_id: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  transaction_type: string;
  reference_id: string | null;
  description: string | null;
  metadata: string | null;
  created_at: string;
}

/**
 * Simulates an in-memory coin ledger for a user.
 * Each operation returns a consistent ledger entry and records all SQL.
 */
class InMemoryCoinLedger {
  balance: number;
  entries: LedgerEntry[] = [];
  queries: Array<{ type: string; sql: string; params: unknown[] }> = [];

  constructor(initialBalance: number) {
    this.balance = initialBalance;
  }

  buildTxClient(): TransactionClient {
    const self = this;
    let entryId = 0;

    return ({
      query: jest.fn(async (sql: string, params: unknown[]) => {
        // Classify query
        const upper = sql.trim().toUpperCase();
        // star_balance queries also match "FOR UPDATE" — check the more specific
        // star_balance condition first so it isn't shadowed by the generic coin check.
        if (upper.startsWith('SELECT') && sql.includes('star_balance')) {
          self.queries.push({ type: 'SELECT_STAR', sql, params });
          return {
            rows: [{ star_balance: String(self.balance) }],
            rowCount: 1,
          };
        }

        if (upper.startsWith('SELECT') && sql.includes('FOR UPDATE')) {
          self.queries.push({ type: 'SELECT_FOR_UPDATE', sql, params });
          return {
            rows: [{ coin_balance: String(self.balance) }],
            rowCount: 1,
          };
        }

        if (upper.startsWith('UPDATE') && sql.includes('coin_balance')) {
          self.queries.push({ type: 'UPDATE_BALANCE', sql, params });
          self.balance = Number(params[0]);
          return { rows: [], rowCount: 1 };
        }

        if (upper.startsWith('UPDATE') && sql.includes('star_balance')) {
          self.queries.push({ type: 'UPDATE_STAR_BALANCE', sql, params });
          self.balance = Number(params[0]);
          return { rows: [], rowCount: 1 };
        }

        if (upper.startsWith('INSERT') && sql.includes('coin_ledger')) {
          self.queries.push({ type: 'INSERT_COIN_LEDGER', sql, params });
          const entry: LedgerEntry = {
            id: `entry-${++entryId}`,
            user_id: params[0] as string,
            amount: params[1] as number,
            balance_before: params[2] as number,
            balance_after: params[3] as number,
            transaction_type: params[4] as string,
            reference_id: params[5] as string | null,
            description: params[6] as string | null,
            metadata: params[7] as string | null,
            created_at: new Date().toISOString(),
          };
          self.entries.push(entry);
          return { rows: [entry], rowCount: 1 };
        }

        if (upper.startsWith('INSERT') && sql.includes('star_ledger')) {
          self.queries.push({ type: 'INSERT_STAR_LEDGER', sql, params });
          const entry: LedgerEntry = {
            id: `entry-${++entryId}`,
            user_id: params[0] as string,
            amount: params[1] as number,
            balance_before: params[2] as number,
            balance_after: params[3] as number,
            transaction_type: params[4] as string,
            reference_id: params[5] as string | null,
            description: params[6] as string | null,
            metadata: null,
            created_at: new Date().toISOString(),
          };
          self.entries.push(entry);
          return { rows: [entry], rowCount: 1 };
        }

        // SELECT * FROM coin_ledger / star_ledger (fetch last entry)
        if (upper.startsWith('SELECT') && (sql.includes('coin_ledger') || sql.includes('star_ledger'))) {
          self.queries.push({ type: 'SELECT_LEDGER', sql, params });
          const last = self.entries[self.entries.length - 1];
          return { rows: last ? [last] : [], rowCount: last ? 1 : 0 };
        }

        self.queries.push({ type: 'OTHER', sql, params });
        return { rows: [], rowCount: 0 };
      }),
    }) as unknown as TransactionClient;
  }
}

function wrapTransaction(ledger: InMemoryCoinLedger) {
  mockTransaction.mockImplementation(
    async (fn: (tx: TransactionClient) => Promise<unknown>) => {
      return fn(ledger.buildTxClient());
    }
  );
}

// ---------------------------------------------------------------------------
// Credit + Debit leaves balance unchanged
// ---------------------------------------------------------------------------

describe('Credit + Debit balance invariant', () => {
  beforeEach(() => jest.clearAllMocks());

  it('coin balance returns to original value after equal credit and debit', async () => {
    const INITIAL = 1000;
    const AMOUNT = 250;

    const ledger = new InMemoryCoinLedger(INITIAL);
    wrapTransaction(ledger);

    await creditCoins('user-1', AMOUNT, 'quest_reward', null, null, null, ledger.buildTxClient() as any);
    // After credit, balance should be INITIAL + AMOUNT
    expect(ledger.balance).toBe(INITIAL + AMOUNT);

    // Re-set the transaction mock for the debit call with the updated balance
    const ledgerAfterCredit = new InMemoryCoinLedger(INITIAL + AMOUNT);
    wrapTransaction(ledgerAfterCredit);

    await debitCoins('user-1', AMOUNT, 'gift_sent', null, null, null, ledgerAfterCredit.buildTxClient() as any);
    expect(ledgerAfterCredit.balance).toBe(INITIAL);
  });

  it('star balance returns to original value after equal credit and debit', async () => {
    const INITIAL = 500;
    const AMOUNT = 100;

    const ledger = new InMemoryCoinLedger(INITIAL);

    // Credit stars
    const creditEntry = await creditStars('user-1', AMOUNT, 'quest_reward', null, null, ledger.buildTxClient() as any);
    expect(ledger.balance).toBe(INITIAL + AMOUNT);

    // Debit stars
    const debitLedger = new InMemoryCoinLedger(INITIAL + AMOUNT);
    await debitStars('user-1', AMOUNT, 'gift_sent', null, null, debitLedger.buildTxClient() as any);
    expect(debitLedger.balance).toBe(INITIAL);
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
    const NET = AMOUNT - Math.floor(AMOUNT * FEE / 100); // 190

    // Build two separate ledgers for sender and receiver
    const senderLedger = new InMemoryCoinLedger(SENDER_INITIAL);
    const receiverLedger = new InMemoryCoinLedger(0);

    mockTransaction.mockImplementation(
      async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        // Outer transfer transaction wraps sender and receiver operations
        const txClient = {
          query: jest.fn(async (sql: string, params: unknown[]) => {
            const upper = sql.trim().toUpperCase();

            // Only the coin_balance lock needs a real response — the two generic
            // "SELECT id FROM users ... FOR UPDATE" deadlock pre-locks don't.
            if (upper.startsWith('SELECT') && sql.includes('FOR UPDATE') && sql.includes('coin_balance')) {
              const userId = params[0] as string;
              const ledger = userId === 'sender-1' ? senderLedger : receiverLedger;
              ledger.queries.push({ type: 'SELECT_FOR_UPDATE', sql, params });
              return { rows: [{ coin_balance: String(ledger.balance) }], rowCount: 1 };
            }

            if (upper.startsWith('UPDATE') && sql.includes('coin_balance')) {
              const newBalance = Number(params[0]);
              const userId = params[1] as string;
              if (userId === 'sender-1') {
                senderLedger.balance = newBalance;
              } else {
                receiverLedger.balance = newBalance;
              }
              return { rows: [], rowCount: 1 };
            }

            if (upper.startsWith('INSERT') && sql.includes('coin_ledger')) {
              return { rows: [{ id: `lid-${params[0]}`, user_id: params[0], amount: params[1], balance_before: params[2], balance_after: params[3], transaction_type: params[4], reference_id: params[5] ?? null, description: params[6] ?? null, metadata: null, created_at: new Date().toISOString() }], rowCount: 1 };
            }

            return { rows: [], rowCount: 0 };
          }),
        } as unknown as TransactionClient;
        return fn(txClient);
      }
    );

    await transferCoins('sender-1', 'receiver-1', AMOUNT, 'idem-ref-1', FEE);

    expect(senderLedger.balance).toBe(SENDER_INITIAL - AMOUNT);
    expect(receiverLedger.balance).toBe(NET);
  });

  it('feeCoins is correctly calculated as floor(amount * feePercent / 100)', async () => {
    // 7% of 100 = 7 coins
    let callCount = 0;
    mockTransaction.mockImplementation(
      async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        callCount++;
        const balance = callCount <= 1 ? 1000 : 0;
        const txClient = {
          query: jest.fn(async (sql: string, params: unknown[]) => {
            const upper = sql.trim().toUpperCase();
            if (upper.startsWith('SELECT') && sql.includes('FOR UPDATE')) {
              return { rows: [{ coin_balance: String(balance) }], rowCount: 1 };
            }
            if (upper.startsWith('SELECT') && sql.includes('coin_ledger')) {
              return {
                rows: [{
                  id: 'e1', user_id: params[0], amount: 0, balance_before: 0,
                  balance_after: 0, transaction_type: 'gift_sent',
                  reference_id: null, description: null, metadata: null,
                  created_at: new Date().toISOString(),
                }],
                rowCount: 1,
              };
            }
            return { rows: [], rowCount: 0 };
          }),
        } as unknown as TransactionClient;
        return fn(txClient);
      }
    );

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
    const queriesSeen: string[] = [];

    mockTransaction.mockImplementation(
      async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        const tx = {
          query: jest.fn(async (sql: string) => {
            queriesSeen.push(sql);
            if (sql.includes('SELECT coin_balance FROM users') && sql.includes('FOR UPDATE')) {
              return { rows: [{ coin_balance: '100' }], rowCount: 1 };
            }
            if (sql.includes('SELECT * FROM coin_ledger')) {
              return {
                rows: [{
                  id: 'entry-1', user_id: 'u1', amount: 50,
                  balance_before: 100, balance_after: 150,
                  transaction_type: 'quest_reward',
                  reference_id: null, description: null, metadata: null,
                  created_at: new Date().toISOString(),
                }],
                rowCount: 1,
              };
            }
            return { rows: [], rowCount: 0 };
          }),
        } as unknown as TransactionClient;
        return fn(tx);
      }
    );

    await creditCoins('user-1', 50, 'quest_reward');

    const updateOnLedger = queriesSeen.find(
      (sql) =>
        sql.trim().toUpperCase().startsWith('UPDATE') &&
        sql.toLowerCase().includes('coin_ledger')
    );
    expect(updateOnLedger).toBeUndefined();
  });

  it('debitCoins never issues UPDATE on coin_ledger', async () => {
    const queriesSeen: string[] = [];

    mockTransaction.mockImplementation(
      async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        const tx = {
          query: jest.fn(async (sql: string) => {
            queriesSeen.push(sql);
            if (sql.includes('SELECT coin_balance FROM users') && sql.includes('FOR UPDATE')) {
              return { rows: [{ coin_balance: '500' }], rowCount: 1 };
            }
            if (sql.includes('SELECT * FROM coin_ledger')) {
              return {
                rows: [{
                  id: 'entry-1', user_id: 'u1', amount: -100,
                  balance_before: 500, balance_after: 400,
                  transaction_type: 'gift_sent',
                  reference_id: null, description: null, metadata: null,
                  created_at: new Date().toISOString(),
                }],
                rowCount: 1,
              };
            }
            return { rows: [], rowCount: 0 };
          }),
        } as unknown as TransactionClient;
        return fn(tx);
      }
    );

    await debitCoins('user-1', 100, 'gift_sent');

    const updateOnLedger = queriesSeen.find(
      (sql) =>
        sql.trim().toUpperCase().startsWith('UPDATE') &&
        sql.toLowerCase().includes('coin_ledger')
    );
    expect(updateOnLedger).toBeUndefined();
  });

  it('creditStars never issues UPDATE on star_ledger', async () => {
    const queriesSeen: string[] = [];

    const tx = {
      query: jest.fn(async (sql: string) => {
        queriesSeen.push(sql);
        if (sql.includes('SELECT star_balance FROM users') && sql.includes('FOR UPDATE')) {
          return { rows: [{ star_balance: '50' }], rowCount: 1 };
        }
        if (sql.includes('SELECT * FROM star_ledger')) {
          return {
            rows: [{
              id: 'entry-1', user_id: 'u1', amount: 10,
              balance_before: 50, balance_after: 60,
              transaction_type: 'quest_reward',
              reference_id: null, description: null,
              created_at: new Date().toISOString(),
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as TransactionClient;

    await creditStars('user-1', 10, 'quest_reward', null, null, tx as any);

    const updateOnStarLedger = queriesSeen.find(
      (sql) =>
        sql.trim().toUpperCase().startsWith('UPDATE') &&
        sql.toLowerCase().includes('star_ledger')
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
    // This should not throw at the validation step
    const ledger = new InMemoryCoinLedger(0);
    // The function should reject because we haven't set up the tx properly
    // but the validation itself should pass
    const validAmounts = [1, 10, 100, 1000, 99999];
    for (const amount of validAmounts) {
      // Validation happens before DB access; using invalid tx to confirm no throw at validation
      try {
        await creditCoins('user-1', amount, 'quest_reward', null, null, null, ledger.buildTxClient() as any);
        // Balance won't actually change here since mock SELECT returns 0
        // but the call should not throw a validation error
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
    let balance = 0;

    // Each call to mockTransaction gets its own closure over the current balance
    mockTransaction.mockImplementation(
      async (fn: (tx: TransactionClient) => Promise<unknown>) => {
        const capturedBalance = balance;
        const tx = {
          query: jest.fn(async (sql: string, params: unknown[]) => {
            const upper = sql.trim().toUpperCase();

            if (upper.startsWith('SELECT') && sql.includes('FOR UPDATE')) {
              return { rows: [{ coin_balance: String(capturedBalance) }], rowCount: 1 };
            }

            if (upper.startsWith('UPDATE') && sql.includes('coin_balance')) {
              balance = Number(params[0]);
              return { rows: [], rowCount: 0 };
            }

            if (upper.startsWith('INSERT') && sql.includes('coin_ledger')) {
              insertedEntries.push([...params]);
              return { rows: [{ id: `entry-${insertedEntries.length}`, user_id: params[0], amount: params[1], balance_before: params[2], balance_after: params[3], transaction_type: params[4], reference_id: params[5] ?? null, description: params[6] ?? null, metadata: null, created_at: new Date().toISOString() }], rowCount: 1 };
            }

            if (upper.startsWith('SELECT') && sql.includes('coin_ledger')) {
              return {
                rows: [{
                  id: `entry-${insertedEntries.length}`,
                  user_id: 'u1', amount: 0, balance_before: 0, balance_after: 0,
                  transaction_type: 'quest_reward', reference_id: null,
                  description: null, metadata: null,
                  created_at: new Date().toISOString(),
                }],
                rowCount: 1,
              };
            }

            return { rows: [], rowCount: 0 };
          }),
        } as unknown as TransactionClient;
        return fn(tx);
      }
    );

    // Execute three sequential credits
    await creditCoins('user-1', 100, 'quest_reward');
    await creditCoins('user-1', 200, 'daily_login');
    await creditCoins('user-1', 50, 'purchase');

    // Each credit should have produced exactly one INSERT on coin_ledger
    expect(insertedEntries.length).toBe(3);

    // Final balance should be 100 + 200 + 50 = 350
    expect(balance).toBe(350);
  });
});
