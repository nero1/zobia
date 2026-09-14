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

import { updatePaymentContextSettings, makeAllPaymentsFree, enforcePaymentContext } from '../contextSettings';
import { ApiError } from '@/lib/api/errors';

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

describe('enforcePaymentContext', () => {
  function mockSettings(row: {
    paystack_enabled?: boolean;
    crypto_enabled_currencies?: string[];
    is_free?: boolean;
  }) {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        context_key: 'coin_purchase',
        paystack_enabled: row.paystack_enabled ?? true,
        crypto_enabled_currencies: row.crypto_enabled_currencies ?? [],
        is_free: row.is_free ?? false,
        updated_at: null,
      }],
    });
  }

  it('returns isFree=true and skips every other check when the context is free', async () => {
    mockSettings({ is_free: true, paystack_enabled: false, crypto_enabled_currencies: [] });
    const decision = await enforcePaymentContext('coin_purchase', false, 'paystack', undefined);
    expect(decision).toEqual({ isFree: true });
  });

  it('rejects a disabled provider even though the client asked for it (bypass attempt)', async () => {
    mockSettings({ paystack_enabled: false, crypto_enabled_currencies: ['JAGA'] });
    await expect(enforcePaymentContext('coin_purchase', true, 'paystack', undefined)).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects a crypto currency the admin has not enabled for this context', async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: ['JAGA'] });
    await expect(enforcePaymentContext('coin_purchase', false, 'crypto', 'BNB' as never)).rejects.toBeInstanceOf(ApiError);
  });

  it('accepts an enabled crypto currency', async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: ['JAGA', 'BNB'] });
    const decision = await enforcePaymentContext('coin_purchase', false, 'crypto', 'BNB' as never);
    expect(decision).toEqual({ isFree: false, provider: 'crypto', cryptoCurrency: 'BNB' });
  });

  it('rejects a non-Nigerian user when only paystack is enabled ("only Nigeria" case)', async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: [] });
    await expect(enforcePaymentContext('coin_purchase', false, undefined, undefined)).rejects.toMatchObject({ code: 'UNSUPPORTED_REGION' });
  });

  it('defaults a Nigerian user to paystack when no provider is requested', async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: ['JAGA'] });
    const decision = await enforcePaymentContext('coin_purchase', true, undefined, undefined);
    expect(decision).toEqual({ isFree: false, provider: 'paystack' });
  });

  it('defaults a non-Nigerian user to crypto when paystack is unavailable to them', async () => {
    mockSettings({ paystack_enabled: true, crypto_enabled_currencies: ['JAGA'] });
    await expect(enforcePaymentContext('coin_purchase', false, undefined, undefined)).rejects.toThrow(
      'cryptoCurrency is required'
    );
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
