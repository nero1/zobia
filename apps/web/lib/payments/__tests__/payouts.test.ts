/**
 * Unit tests for lib/payments/payouts.ts
 *
 * lib/payments/payouts.ts has been migrated to Drizzle ORM (getDb() /
 * orm.transaction() / raw `sql` escape hatches) instead of the raw
 * `@/lib/db` adapter. Rather than hand-mock every query shape, these tests
 * back a *real* `drizzle-orm/node-postgres` instance with a fake
 * `pg`-shaped client whose `query()` is a jest.fn. Every query the module
 * issues still goes through real Drizzle query compilation — exactly like
 * production — and lands on `mockQuery` as plain SQL text + params, which
 * tests dispatch on (see lib/seasons/__tests__/seasonEngine.test.ts for the
 * same pattern).
 *
 * Paystack and Redis (the circuit breaker) remain separately mocked.
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

// payouts.ts does not import `@/lib/db` (the raw adapter) directly, but
// keep it mocked defensively so no test accidentally opens a real
// connection.
jest.mock("@/lib/db", () => ({ db: {} }));

jest.mock("@/lib/payments/paystack", () => ({
  initiateTransfer: jest.fn(),
  verifyTransfer: jest.fn(),
}));

// Payout processing runs a Redis-backed circuit breaker (assertCircuitClosed /
// recordCircuitFailure / recordCircuitSuccess) around each transfer attempt,
// plus alerts/notifications on the DLQ path — mock all of it so tests don't
// need a live REDIS_PROVIDER or hit unrelated code paths.
jest.mock("@/lib/redis", () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  },
}));

jest.mock("@/lib/alerts/dispatch", () => ({
  raiseAlert: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/notifications/insert", () => ({
  insertNotification: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (must come after mocks)
// ---------------------------------------------------------------------------

import {
  getCreatorFeeRate,
  processPendingPayouts,
  reconcileStuckPayouts,
  moveToDeadLetterQueue,
} from "@/lib/payments/payouts";
import { initiateTransfer, verifyTransfer } from "@/lib/payments/paystack";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePendingPayout(overrides: Record<string, unknown> = {}) {
  return {
    id: "payout-1",
    creator_id: "creator-1",
    net_kobo: 80000,
    gross_kobo: 100000,
    idempotency_key: "idem-1",
    provider_reference: null,
    retry_count: 0,
    bank_account_snapshot: {
      recipient_code: "RCP_abc",
      bank_name: "Zenith Bank",
      account_name: "John Doe",
      last4: "1234",
    },
    ...overrides,
  };
}

// `.select({...})` queries go through pg's positional ("array") row mode —
// mocked rows must be arrays of values in the same order as the selected
// field object, not keyed objects.

/** Matches moveToDeadLetterQueue's row-lock select: {netKobo, grossKobo, earningsRestored, status}. */
function dlqLockRow(f: {
  netKobo?: bigint | number | null;
  grossKobo?: bigint | number | null;
  earningsRestored?: boolean;
  status?: string;
}) {
  return [f.netKobo ?? BigInt(80000), f.grossKobo ?? BigInt(100000), f.earningsRestored ?? false, f.status ?? "processing"];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("getCreatorFeeRate", () => {
  it("returns 0.15 for icon tier", () => {
    expect(getCreatorFeeRate("icon")).toBe(0.15);
  });

  it("returns 0.20 for all other tiers", () => {
    expect(getCreatorFeeRate("rising")).toBe(0.20);
    expect(getCreatorFeeRate("standard")).toBe(0.20);
    expect(getCreatorFeeRate(null)).toBe(0.20);
    expect(getCreatorFeeRate(undefined)).toBe(0.20);
  });
});

describe("processPendingPayouts", () => {
  it("returns zero counts when there are no pending payouts", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await processPendingPayouts(10, 3);

    expect(result).toEqual({ processed: 0, retried: 0, failed: 0, dlq: 0 });
  });

  it("increments processed count on successful transfer", async () => {
    // Phase 1 (raw sql UPDATE ... RETURNING): one pending payout; every other
    // query (phase 2, the per-payout update) returns empty.
    mockQuery.mockImplementation((text: string) => {
      if (text.includes("UPDATE creator_payouts") && text.includes("status = 'pending'")) {
        return Promise.resolve({ rows: [makePendingPayout()], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    (initiateTransfer as jest.Mock).mockResolvedValue({
      transfer_code: "TRF_001",
      id: 1,
      reference: "idem-1",
      amount: 80000,
      status: "pending",
    });

    const result = await processPendingPayouts(10, 3);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.dlq).toBe(0);
  });

  it("moves to DLQ when recipient_code is missing", async () => {
    const badPayout = makePendingPayout({ bank_account_snapshot: null });

    mockQuery.mockImplementation((text: string) => {
      if (text.includes("UPDATE creator_payouts") && text.includes("status = 'pending'")) {
        return Promise.resolve({ rows: [badPayout], rowCount: 1 });
      }
      // moveToDeadLetterQueue's row lock (`.select(...).for("update")`) needs
      // a row so it doesn't hit its early-return guard.
      if (text.includes('from "creator_payouts"') && text.includes("for update")) {
        return Promise.resolve({
          rows: [dlqLockRow({ status: "processing", earningsRestored: false })],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await processPendingPayouts(10, 3);

    expect(result.dlq).toBeGreaterThanOrEqual(1);
    expect(initiateTransfer).not.toHaveBeenCalled();
  });

  it("does not double-pay on retry when prior transfer already succeeded", async () => {
    const retryPayout = makePendingPayout({
      retry_count: 1,
      provider_reference: "TRF_prior",
    });

    mockQuery.mockImplementation((text: string) => {
      // Phase 1 (pending): empty. Phase 2 (retry queue): the retry payout.
      if (text.includes("UPDATE creator_payouts") && text.includes("status = 'failed'")) {
        return Promise.resolve({ rows: [retryPayout], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    (verifyTransfer as jest.Mock).mockResolvedValue({ status: "success" });

    const result = await processPendingPayouts(10, 3);

    expect(result.retried).toBe(1);
    expect(initiateTransfer).not.toHaveBeenCalled();
  });
});

describe("reconcileStuckPayouts (BUG-PY01)", () => {
  it("uses CTE with FOR UPDATE SKIP LOCKED", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await reconcileStuckPayouts();

    expect(mockQuery).toHaveBeenCalled();
    const candidatesCall = mockQuery.mock.calls.find(
      ([text]: [string]) => typeof text === "string" && text.includes("WITH candidates AS")
    );
    expect(candidatesCall).toBeDefined();
    const [sql] = candidatesCall as [string];
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sql).toMatch(/WITH candidates AS/i);
  });
});

describe("moveToDeadLetterQueue", () => {
  it("inserts into payout_dead_letter_queue", async () => {
    // The FOR UPDATE lock query needs to return a row for the function to
    // proceed past its early-return guard (`if (!current[0]) return;`).
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('from "creator_payouts"') && text.includes("for update")) {
        return Promise.resolve({
          rows: [dlqLockRow({ netKobo: BigInt(80000), grossKobo: BigInt(100000), earningsRestored: false, status: "failed" })],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await moveToDeadLetterQueue("payout-1", "creator-1", 2, "test reason");

    // The dead-letter insert is one of several queries run inside the
    // transaction (lock, status update, earnings restore, DLQ insert) —
    // find it rather than assuming it's the first call.
    const dlqCall = mockQuery.mock.calls.find(
      ([text]) => typeof text === "string" && /payout_dead_letter_queue/i.test(text)
    );
    expect(dlqCall).toBeDefined();
  });
});
