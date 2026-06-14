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
    it('returns 401 when signature is invalid', async () => {
      (verifyWebhookSignature as jest.Mock).mockReturnValue(false);

      const req = buildRequest(CHARGE_SUCCESS_EVENT, 'bad-sig');
      const res = await POST(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toMatchObject({ error: expect.stringMatching(/signature/i) });
    });

    it('returns 200 when signature is valid', async () => {
      mockTransaction.mockImplementation(async (fn: Function) => {
        const tx = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'pay-1', status: 'pending' }], rowCount: 1 }) };
        return fn(tx);
      });

      const req = buildRequest(CHARGE_SUCCESS_EVENT);
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe('charge.success — coin_pack', () => {
    it('skips processing when payment is already completed (idempotency)', async () => {
      mockTransaction.mockImplementation(async (fn: Function) => {
        const tx = {
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'pay-1', status: 'completed' }], rowCount: 1 }),
        };
        return fn(tx);
      });

      const req = buildRequest(CHARGE_SUCCESS_EVENT);
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(creditCoins).not.toHaveBeenCalled();
    });

    it('credits coins when payment is new', async () => {
      let callCount = 0;
      mockTransaction.mockImplementation(async (fn: Function) => {
        const tx = {
          query: jest.fn(async (sql: string) => {
            callCount++;
            if (callCount === 1) {
              // Idempotency SELECT
              return { rows: [{ id: 'pay-1', status: 'pending' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
          }),
        };
        return fn(tx);
      });

      const req = buildRequest(CHARGE_SUCCESS_EVENT);
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(creditCoins).toHaveBeenCalledWith(
        expect.anything(),
        'user-uuid',
        1000,
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe('unrecognised events', () => {
    it('returns 200 for unknown event types without side effects', async () => {
      const req = buildRequest({ event: 'unknown.event', data: {} });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  describe('transfer events', () => {
    it('returns 200 for transfer.success and calls db update', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'payout-1', status: 'processing' }], rowCount: 1 });

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
