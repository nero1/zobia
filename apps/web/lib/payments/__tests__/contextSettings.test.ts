/**
 * Unit tests for lib/payments/contextSettings.ts
 *
 * Key invariants tested:
 *  - updatePaymentContextSettings only overwrites the fields present in the
 *    patch — an undefined field must not clobber the existing value.
 *  - makeAllPaymentsFree issues a single unconditional UPDATE (no WHERE
 *    clause needed — every context row that exists gets `is_free = true`).
 */

const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({ db: { query: (...args: unknown[]) => mockQuery(...args) } }));

import { updatePaymentContextSettings, makeAllPaymentsFree } from '../contextSettings';

beforeEach(() => jest.clearAllMocks());

describe('updatePaymentContextSettings', () => {
  it('preserves existing fields not present in the patch', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          context_key: 'coin_purchase',
          paystack_enabled: true,
          crypto_enabled_currencies: ['JAGA'],
          is_free: false,
          updated_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // the upsert itself

    await updatePaymentContextSettings('coin_purchase', { isFree: true }, 'admin-1');

    const upsertCall = mockQuery.mock.calls[1];
    const params = upsertCall[1];
    // [context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by]
    expect(params[1]).toBe(true); // paystackEnabled preserved
    expect(JSON.parse(params[2])).toEqual(['JAGA']); // cryptoEnabledCurrencies preserved
    expect(params[3]).toBe(true); // isFree updated
  });
});

describe('makeAllPaymentsFree', () => {
  it('runs a single UPDATE setting is_free = true for every context', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await makeAllPaymentsFree('admin-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/UPDATE payment_context_settings SET is_free = true/);
  });
});
