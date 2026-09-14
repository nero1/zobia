/**
 * Unit tests for lib/payments/crypto/priceFeed.ts
 *
 * Key invariants tested:
 *  - A manual override takes precedence over the cache/live fetch.
 *  - An expired manual override is ignored (falls through to cache/live).
 *  - A fresh cache entry is served without a live fetch.
 *  - A stale cache entry triggers a live fetch and updates the cache.
 *  - A failed live fetch falls back to the stale cache instead of throwing.
 *  - With nothing cached and no override, a failed live fetch throws
 *    PriceFeedUnavailableError.
 */

const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  db: { query: (...args: unknown[]) => mockQuery(...args) },
}));

jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/manifest', () => ({
  getManifestValue: jest.fn(),
}));

jest.mock('@/lib/payments/circuit', () => ({
  cryptoPriceFeedBreaker: { execute: (fn: () => unknown) => fn() },
}));

import { getManifestValue } from '@/lib/manifest';
import { getUsdPrice, PriceFeedUnavailableError } from '../priceFeed';

const mockGetManifestValue = getManifestValue as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetManifestValue.mockResolvedValue(null); // default refresh interval (360 min)
  global.fetch = jest.fn();
});

describe('getUsdPrice', () => {
  it('returns the manual override when active (no expiry)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ usd_price: '650.00', expires_at: null }] }); // override lookup
    const result = await getUsdPrice('BNB');
    expect(result.source).toBe('manual');
    expect(result.usdPrice.toString()).toBe('650');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores an expired manual override and falls through to a fresh cache', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ usd_price: '999', expires_at: '2020-01-01T00:00:00Z' }] }) // expired override
      .mockResolvedValueOnce({ rows: [{ usd_price: '150.25', source: 'live', fetched_at: new Date().toISOString() }] }); // fresh cache
    const result = await getUsdPrice('SOL');
    expect(result.source).toBe('live');
    expect(result.usdPrice.toString()).toBe('150.25');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refetches live when the cache is stale and writes the new price back', async () => {
    const staleDate = new Date(Date.now() - 400 * 60_000).toISOString(); // >360min old
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no override
      .mockResolvedValueOnce({ rows: [{ usd_price: '600', source: 'live', fetched_at: staleDate }] }) // stale cache
      .mockResolvedValueOnce({ rows: [] }); // cache write
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ binancecoin: { usd: 700 } }),
    });
    const result = await getUsdPrice('BNB');
    expect(result.source).toBe('live');
    expect(result.usdPrice.toString()).toBe('700');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the stale cache when the live fetch fails', async () => {
    const staleDate = new Date(Date.now() - 400 * 60_000).toISOString();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no override
      .mockResolvedValueOnce({ rows: [{ usd_price: '600', source: 'live', fetched_at: staleDate }] }); // stale cache
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    const result = await getUsdPrice('BNB');
    expect(result.source).toBe('stale-cache');
    expect(result.usdPrice.toString()).toBe('600');
  });

  it('throws PriceFeedUnavailableError when there is no cache, no override, and the live fetch fails', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no override
      .mockResolvedValueOnce({ rows: [] }); // no cache
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    await expect(getUsdPrice('SOL')).rejects.toThrow(PriceFeedUnavailableError);
  });
});
