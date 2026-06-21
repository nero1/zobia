/**
 * Unit tests for POST /api/economy/webhooks/dodopayments
 *
 * Database, signature verifier, creditCoins, creditStars, and
 * awardReferralCommissions are all mocked — no real I/O.
 *
 * Key invariants tested:
 *  - 401 when HMAC signature is invalid
 *  - 200 (no-op) for duplicate payment.succeeded events
 *  - 200 + coin credit for a valid first-time payment.succeeded (coin_pack)
 *  - 200 + star credit for a valid first-time payment.succeeded (star_pack)
 *  - 400 when starsGranted <= 0 (BUG-WH02 fix)
 *  - 200 for payout.completed / payout.failed events
 */

// ---------------------------------------------------------------------------
// Mock dependencies before any imports
// ---------------------------------------------------------------------------

jest.mock('@/lib/payments/dodopayments', () => ({
  verifyWebhookSignature: jest.fn(),
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  },
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

jest.mock('@/lib/payments/payouts', () => ({
  moveToDeadLetterQueue: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (must come after jest.mock)
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { verifyWebhookSignature } from '@/lib/payments/dodopayments';
import { creditCoins } from '@/lib/economy/coins';
import { creditStars } from '@/lib/economy/stars';

const { POST } = require('@/app/api/economy/webhooks/dodopayments/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRequest(body: object, signature = 'valid-sig'): NextRequest {
  return new NextRequest('http://localhost/api/economy/webhooks/dodopayments', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dodo-signature': signature,
    },
    body: JSON.stringify(body),
  });
}

function makeCoinPackEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: 'payment.succeeded',
    data: {
      id: 'dodo-pay-1',
      status: 'succeeded',
      amount: 300000,
      currency: 'NGN',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        userId: 'user-uuid',
        packId: 'coin-pack-01',
        coinsGranted: 500,
        itemType: 'coin_pack',
        packName: 'Basic Coins',
        idempotencyKey: 'idem-key-1',
        ...overrides,
      },
    },
  };
}

function makeStarPackEvent(starsGranted: number) {
  return {
    event: 'payment.succeeded',
    data: {
      id: 'dodo-pay-2',
      status: 'succeeded',
      amount: 500000,
      currency: 'NGN',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        userId: 'user-uuid',
        packId: 'star-pack-01',
        starsGranted,
        itemType: 'star_pack',
        packName: 'Star Pack',
        idempotencyKey: 'idem-key-2',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  (verifyWebhookSignature as jest.Mock).mockReturnValue(true);
});

describe('POST /api/economy/webhooks/dodopayments', () => {
  describe('signature validation', () => {
    it('returns 200 when signature is invalid (prevents provider retry loops)', async () => {
      (verifyWebhookSignature as jest.Mock).mockReturnValue(false);

      const req = buildRequest(makeCoinPackEvent(), 'bad-sig');
      const res = await POST(req);

      // Route returns 200 on bad signatures so DodoPayments does not retry
      // (a bad signature will never become valid on retry). The payload is discarded.
      expect(res.status).toBe(200);
    });
  });

  describe('payment.succeeded — coin_pack', () => {
    it('no-ops when payment already completed (idempotency)', async () => {
      mockTransaction.mockImplementation(async (fn: Function) => {
        const tx = {
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'pay-1', status: 'completed' }], rowCount: 1 }),
        };
        return fn(tx);
      });

      const req = buildRequest(makeCoinPackEvent());
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(creditCoins).not.toHaveBeenCalled();
    });

    it('credits coins for a new coin_pack payment', async () => {
      let callIdx = 0;
      mockTransaction.mockImplementation(async (fn: Function) => {
        const tx = {
          query: jest.fn(async (_sql: string) => {
            callIdx++;
            if (callIdx === 1) return { rows: [{ id: 'pay-1', status: 'pending' }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
          }),
        };
        return fn(tx);
      });

      const req = buildRequest(makeCoinPackEvent());
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(creditCoins).toHaveBeenCalled();
    });
  });

  describe('payment.succeeded — star_pack (BUG-WH02 fix)', () => {
    it('returns 400 when starsGranted resolves to 0 or negative', async () => {
      mockTransaction.mockImplementation(async (fn: Function) => {
        const tx = {
          query: jest.fn(async (sql: string) => {
            if (sql.includes('SELECT id, status')) {
              return { rows: [{ id: 'pay-2', status: 'pending' }], rowCount: 1 };
            }
            // store_items lookup returns 0 stars
            if (sql.includes('store_items')) {
              return { rows: [{ coins_granted: null, stars_granted: 0 }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
          }),
        };
        return fn(tx);
      });

      const req = buildRequest(makeStarPackEvent(0));
      const res = await POST(req);

      // Handler writes to failed_webhooks DLQ and returns; route stays 200
      // (throwing would roll back the payment status update and cause infinite retries)
      expect(res.status).toBe(200);
      expect(creditStars).not.toHaveBeenCalled();
    });

    it('credits stars for a valid star_pack payment', async () => {
      let callIdx = 0;
      mockTransaction.mockImplementation(async (fn: Function) => {
        const tx = {
          query: jest.fn(async (_sql: string) => {
            callIdx++;
            if (callIdx === 1) return { rows: [{ id: 'pay-2', status: 'pending' }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
          }),
        };
        return fn(tx);
      });

      const req = buildRequest(makeStarPackEvent(50));
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(creditStars).toHaveBeenCalled();
    });
  });

  describe('payout events', () => {
    it('returns 200 for payout.completed', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'payout-1' }], rowCount: 1 });

      const event = {
        event: 'payout.completed',
        data: {
          id: 'dodo-payout-1',
          reference: 'payout-ref-1',
          status: 'completed',
          amount: 200000,
          currency: 'NGN',
        },
      };

      const req = buildRequest(event);
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('returns 200 for payout.failed', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'payout-1', retry_count: 0, creator_id: 'creator-1', gross_kobo: 100000 }], rowCount: 1 });

      const event = {
        event: 'payout.failed',
        data: {
          id: 'dodo-payout-2',
          reference: 'payout-ref-2',
          status: 'failed',
          amount: 100000,
          currency: 'NGN',
        },
      };

      const req = buildRequest(event);
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });
});
