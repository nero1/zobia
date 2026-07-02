/**
 * Unit tests for lib/payments/payouts.ts
 *
 * Database and Paystack API calls are fully mocked.
 *
 * Key invariants tested:
 *  - getCreatorFeeRate returns 15% for icon tier, 20% otherwise
 *  - processPendingPayouts: counts processed/failed/dlq correctly
 *  - reconcileStuckPayouts: uses FOR UPDATE SKIP LOCKED (BUG-PY01 fix)
 *  - moveToDeadLetterQueue: inserts into payout_dead_letter_queue
 */

// ---------------------------------------------------------------------------
// Mock dependencies before imports
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

jest.mock('@/lib/payments/paystack', () => ({
  initiateTransfer: jest.fn(),
  verifyTransfer: jest.fn(),
}));

// Payout processing runs a Redis-backed circuit breaker (assertCircuitClosed /
// recordCircuitFailure / recordCircuitSuccess) around each transfer attempt —
// mock it the same way @/lib/db is mocked above so tests don't need a live
// REDIS_PROVIDER.
jest.mock('@/lib/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  },
}));

// ---------------------------------------------------------------------------
// Imports (must come after mocks)
// ---------------------------------------------------------------------------

import {
  getCreatorFeeRate,
  processPendingPayouts,
  reconcileStuckPayouts,
  moveToDeadLetterQueue,
} from '@/lib/payments/payouts';
import { initiateTransfer, verifyTransfer } from '@/lib/payments/paystack';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePendingPayout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    creator_id: 'creator-1',
    net_kobo: 80000,
    gross_kobo: 100000,
    idempotency_key: 'idem-1',
    provider_reference: null,
    retry_count: 0,
    bank_account_snapshot: {
      recipient_code: 'RCP_abc',
      bank_name: 'Zenith Bank',
      account_name: 'John Doe',
      last4: '1234',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // db.transaction must actually invoke the callback (with a tx client backed
  // by the same mockQuery) for code paths like moveToDeadLetterQueue to run.
  mockTransaction.mockImplementation(async (fn: (tx: { query: typeof mockQuery }) => Promise<unknown>) => {
    return fn({ query: mockQuery });
  });
});

describe('getCreatorFeeRate', () => {
  it('returns 0.15 for icon tier', () => {
    expect(getCreatorFeeRate('icon')).toBe(0.15);
  });

  it('returns 0.20 for all other tiers', () => {
    expect(getCreatorFeeRate('rising')).toBe(0.20);
    expect(getCreatorFeeRate('standard')).toBe(0.20);
    expect(getCreatorFeeRate(null)).toBe(0.20);
    expect(getCreatorFeeRate(undefined)).toBe(0.20);
  });
});

describe('processPendingPayouts', () => {
  it('returns zero counts when there are no pending payouts', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await processPendingPayouts(10, 3);

    expect(result).toEqual({ processed: 0, retried: 0, failed: 0, dlq: 0 });
  });

  it('increments processed count on successful transfer', async () => {
    // Phase 1: return one pending payout; Phase 2: return none
    mockQuery
      .mockResolvedValueOnce({ rows: [makePendingPayout()], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    (initiateTransfer as jest.Mock).mockResolvedValue({
      transfer_code: 'TRF_001',
      id: 1,
      reference: 'idem-1',
      amount: 80000,
      status: 'pending',
    });

    const result = await processPendingPayouts(10, 3);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.dlq).toBe(0);
  });

  it('moves to DLQ when recipient_code is missing', async () => {
    const badPayout = makePendingPayout({ bank_account_snapshot: null });

    mockQuery
      .mockResolvedValueOnce({ rows: [badPayout], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await processPendingPayouts(10, 3);

    expect(result.dlq).toBeGreaterThanOrEqual(1);
    expect(initiateTransfer).not.toHaveBeenCalled();
  });

  it('does not double-pay on retry when prior transfer already succeeded', async () => {
    const retryPayout = makePendingPayout({
      retry_count: 1,
      provider_reference: 'TRF_prior',
    });

    // Phase 1 (pending): empty; Phase 2 (retry): one row
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [retryPayout], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    (verifyTransfer as jest.Mock).mockResolvedValue({ status: 'success' });

    const result = await processPendingPayouts(10, 3);

    expect(result.retried).toBe(1);
    expect(initiateTransfer).not.toHaveBeenCalled();
  });
});

describe('reconcileStuckPayouts (BUG-PY01)', () => {
  it('uses CTE with FOR UPDATE SKIP LOCKED', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await reconcileStuckPayouts();

    expect(mockQuery).toHaveBeenCalled();
    const sql: string = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sql).toMatch(/WITH candidates AS/i);
  });
});

describe('moveToDeadLetterQueue', () => {
  it('inserts into payout_dead_letter_queue', async () => {
    // The FOR UPDATE lock query needs to return a row for the function to
    // proceed past its early-return guard (`if (!current[0]) return;`).
    mockQuery.mockResolvedValue({
      rows: [{ net_kobo: 80000, gross_kobo: 100000, earnings_restored: false, status: 'failed' }],
      rowCount: 1,
    });

    await moveToDeadLetterQueue('payout-1', 'creator-1', 2, 'test reason');

    // The dead-letter insert is one of several queries run inside the
    // transaction (lock, status update, earnings restore, DLQ insert) —
    // find it rather than assuming it's the first call.
    const dlqCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /payout_dead_letter_queue/i.test(sql)
    );
    expect(dlqCall).toBeDefined();
  });
});
