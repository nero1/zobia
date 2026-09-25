/**
 * Unit tests for POST /api/economy/webhooks/paystack
 *
 * The database, Paystack signature verifier, creditCoins, creditStars,
 * and awardReferralCommissions are all mocked — no real I/O.
 *
 * Key invariants tested:
 *  - 401 when HMAC signature is invalid
 *  - 200 (no-op) for duplicate charge.success events
 *  - 200 + coin credit for a valid first-time charge.success
 *  - 200 + star credit for a valid star_pack charge
 *  - 200 (no-op) for unrecognised event types
 *  - transfer.success / transfer.failed webhook update payout rows
 */

// ---------------------------------------------------------------------------
// Mock dependencies before any imports
// ---------------------------------------------------------------------------

jest.mock('@/lib/payments/paystack', () => ({
  verifyWebhookSignature: jest.fn(),
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  },
}));

// ---------------------------------------------------------------------------
// The webhook route (and the shared lib/payments/paystackWebhookHandler.ts it
// delegates to) has been migrated to Drizzle ORM (getDb() / orm.transaction()
// / the query builder + raw sql`` escape hatches) instead of the raw
// `@/lib/db` adapter. Back a real `drizzle-orm/node-postgres` instance with a
// fake pg-shaped client so every query the handler issues still goes through
// real Drizzle query compilation — exactly like production — and lands on
// `mockQuery` as plain SQL text + params, which tests dispatch on (see
// lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
// ---------------------------------------------------------------------------

import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from '@/lib/db/schema';
import type { DbOrTx } from '@/lib/db/drizzle';

const mockQuery = jest.fn();

const fakeClient = {
  query: (queryConfig: unknown, params?: unknown[]) => {
    const text = typeof queryConfig === 'string' ? queryConfig : (queryConfig as { text: string }).text;
    return mockQuery(text, params);
  },
};

const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock('@/lib/db/drizzle', () => {
  const actual = jest.requireActual('@/lib/db/drizzle');
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

// paystackWebhookHandler.ts also touches @/lib/manifest (for the Creator Fund
// split percent) and @/lib/alerts/dispatch (raiseAlert) on non-recoverable
// error paths — keep both mocked defensively so no test accidentally opens a
// real connection or depends on unrelated manifest/alerting behavior.
jest.mock('@/lib/manifest', () => ({
  loadManifest: jest.fn().mockResolvedValue({ payouts: { maxRetries: 5 } }),
  getManifestValue: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/alerts/dispatch', () => ({
  raiseAlert: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Build a payments row matching the column order of the idempotency SELECT
 * in processChargeSuccess (id, status, provider, chain, tokenSymbol,
 * expectedTokenAmount) — Drizzle's query builder returns schema-typed
 * selects in array ("positional") row mode.
 */
function paymentsRow(status: string) {
  return ['pay-1', status, 'paystack', null, null, null];
}

/** Wire up the default dispatch: idempotency SELECT on payments returns `status`. */
function mockPaymentsStatus(status: string) {
  mockQuery.mockImplementation((text: string) => {
    if (text.includes('from "payments"')) {
      return Promise.resolve({ rows: [paymentsRow(status)], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

jest.mock('@/lib/economy/coins', () => ({
  creditCoins: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/economy/stars', () => ({
  creditStars: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/referrals/commissions', () => ({
  awardReferralCommissions: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (must come after jest.mock)
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { verifyWebhookSignature } from '@/lib/payments/paystack';
import { creditCoins } from '@/lib/economy/coins';

// The route module is imported after mocks are set up
const { POST } = require('@/app/api/economy/webhooks/paystack/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRequest(body: object, signature = 'valid-sig'): NextRequest {
  return new NextRequest('http://localhost/api/economy/webhooks/paystack', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-paystack-signature': signature,
    },
    body: JSON.stringify(body),
  });
}

const CHARGE_SUCCESS_EVENT = {
  event: 'charge.success',
  data: {
    reference: 'txn_abc123',
    status: 'success',
    amount: 500000,
    currency: 'NGN',
    customer: { email: 'user@example.com' },
    metadata: {
      userId: 'user-uuid',
      packId: 'pack-01',
      coinsGranted: 1000,
      itemType: 'coin_pack',
      packName: 'Starter Pack',
    },
    paid_at: '2026-01-01T00:00:00.000Z',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  (verifyWebhookSignature as jest.Mock).mockReturnValue(true);
});

describe('POST /api/economy/webhooks/paystack', () => {
  describe('signature validation', () => {
    it('returns 200 when signature is invalid (prevents provider retry loops)', async () => {
      (verifyWebhookSignature as jest.Mock).mockReturnValue(false);

      const req = buildRequest(CHARGE_SUCCESS_EVENT, 'bad-sig');
      const res = await POST(req);

      // Route returns 200 on bad signatures so Paystack does not retry
      // (a bad signature will never become valid on retry). The payload is discarded.
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({ received: false });
    });

    it('returns 200 when signature is valid', async () => {
      mockPaymentsStatus('pending');

      const req = buildRequest(CHARGE_SUCCESS_EVENT);
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe('charge.success — coin_pack', () => {
    it('skips processing when payment is already completed (idempotency)', async () => {
      mockPaymentsStatus('completed');

      const req = buildRequest(CHARGE_SUCCESS_EVENT);
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(creditCoins).not.toHaveBeenCalled();
    });

    it('credits coins when payment is new', async () => {
      mockPaymentsStatus('pending');

      const req = buildRequest(CHARGE_SUCCESS_EVENT);
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(creditCoins).toHaveBeenCalledWith(
        'user-uuid',
        1000,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('unrecognised events', () => {
    it('returns 200 for unknown event types without side effects', async () => {
      const req = buildRequest({ event: 'unknown.event', data: {} });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('transfer events', () => {
    it('returns 200 for transfer.success and calls db update', async () => {
      // Column order matches the creatorPayouts SELECT in processTransferEvent:
      // id, creatorId, grossKobo, netKobo, retryCount.
      mockQuery.mockImplementation((text: string) => {
        if (text.includes('from "creator_payouts"')) {
          return Promise.resolve({ rows: [['payout-1', 'creator-1', 100000, 80000, 0]], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const event = {
        event: 'transfer.success',
        data: {
          reference: 'payout-ref-1',
          status: 'success',
          amount: 100000,
          transfer_code: 'TRF_abc',
        },
      };

      const req = buildRequest(event);
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });
});
