/**
 * Unit tests for lib/payments/crypto/priceFeed.ts
 *
 * lib/payments/crypto/priceFeed.ts has been migrated to Drizzle ORM
 * (getDb() / the query builder) instead of the raw `@/lib/db` adapter.
 * Rather than hand-mock every `.select()/.insert()` chain shape, these
 * tests back a *real* `drizzle-orm/node-postgres` instance with a fake
 * `pg`-shaped client whose `query()` is a jest.fn. Every query the module
 * issues still goes through real Drizzle query compilation — exactly like
 * production — and lands on `mockQuery` as plain SQL text + params, which
 * tests dispatch on (see lib/seasons/__tests__/seasonEngine.test.ts for the
 * same pattern).
 *
 * Note: `client.query()` for a "fields" (select) query is invoked in pg's
 * positional ("array") row mode, so mocked rows must be arrays of values in
 * the same order as the `.select({...})` object passed to the real query —
 * not keyed objects.
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
// `client.query()` for a non-Pool client).
const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

// priceFeed.ts does not import `@/lib/db` (the raw adapter) directly, but
// keep it mocked defensively so no test accidentally opens a real
// connection.
jest.mock("@/lib/db", () => ({ db: {} }));

jest.mock("@/lib/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

jest.mock("@/lib/manifest", () => ({
  getManifestValue: jest.fn(),
}));

jest.mock("@/lib/payments/circuit", () => ({
  cryptoPriceFeedBreaker: { execute: (fn: () => unknown) => fn() },
}));

import { getManifestValue } from "@/lib/manifest";
import { getUsdPrice, PriceFeedUnavailableError } from "../priceFeed";

const mockGetManifestValue = getManifestValue as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetManifestValue.mockResolvedValue(null); // default refresh interval (360 min)
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  global.fetch = jest.fn();
});

/** Matches the manual-override select: {usdPrice, expiresAt}. */
function overrideRow(usdPrice: string, expiresAt: string | null) {
  return [usdPrice, expiresAt ? new Date(expiresAt) : null];
}

/** Matches the cache-read select: {usdPrice, source, fetchedAt}. */
function cacheRow(usdPrice: string, source: string, fetchedAt: string) {
  return [usdPrice, source, new Date(fetchedAt)];
}

function mockDispatch(handlers: {
  override?: () => { rows: unknown[] };
  cache?: () => { rows: unknown[] };
  cacheWrite?: () => { rows: unknown[] };
}) {
  mockQuery.mockImplementation((text: string) => {
    if (text.includes('from "crypto_exchange_rate_overrides"')) {
      return Promise.resolve(handlers.override ? handlers.override() : { rows: [] });
    }
    if (text.includes('select') && text.includes('from "crypto_price_cache"')) {
      return Promise.resolve(handlers.cache ? handlers.cache() : { rows: [] });
    }
    if (text.includes('insert into "crypto_price_cache"')) {
      return Promise.resolve(handlers.cacheWrite ? handlers.cacheWrite() : { rows: [] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe("getUsdPrice", () => {
  it("returns the manual override when active (no expiry)", async () => {
    mockDispatch({
      override: () => ({ rows: [overrideRow("650.00", null)] }),
    });
    const result = await getUsdPrice("BNB");
    expect(result.source).toBe("manual");
    expect(result.usdPrice.toString()).toBe("650");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("ignores an expired manual override and falls through to a fresh cache", async () => {
    mockDispatch({
      override: () => ({ rows: [overrideRow("999", "2020-01-01T00:00:00Z")] }),
      cache: () => ({ rows: [cacheRow("150.25", "live", new Date().toISOString())] }),
    });
    const result = await getUsdPrice("SOL");
    expect(result.source).toBe("live");
    expect(result.usdPrice.toString()).toBe("150.25");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refetches live when the cache is stale and writes the new price back", async () => {
    const staleDate = new Date(Date.now() - 400 * 60_000).toISOString(); // >360min old
    mockDispatch({
      override: () => ({ rows: [] }), // no override
      cache: () => ({ rows: [cacheRow("600", "live", staleDate)] }), // stale cache
      cacheWrite: () => ({ rows: [] }), // cache write
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ binancecoin: { usd: 700 } }),
    });
    const result = await getUsdPrice("BNB");
    expect(result.source).toBe("live");
    expect(result.usdPrice.toString()).toBe("700");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the stale cache when the live fetch fails", async () => {
    const staleDate = new Date(Date.now() - 400 * 60_000).toISOString();
    mockDispatch({
      override: () => ({ rows: [] }), // no override
      cache: () => ({ rows: [cacheRow("600", "live", staleDate)] }), // stale cache
    });
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));
    const result = await getUsdPrice("BNB");
    expect(result.source).toBe("stale-cache");
    expect(result.usdPrice.toString()).toBe("600");
  });

  it("throws PriceFeedUnavailableError when there is no cache, no override, and the live fetch fails", async () => {
    mockDispatch({
      override: () => ({ rows: [] }), // no override
      cache: () => ({ rows: [] }), // no cache
    });
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));
    await expect(getUsdPrice("SOL")).rejects.toThrow(PriceFeedUnavailableError);
  });
});
