/**
 * lib/payments/crypto/priceFeed.ts
 *
 * USD price feed for supported crypto currencies, with an admin manual
 * override and a lazy-refresh-on-read cache.
 *
 * Design note on the refresh strategy: the platform only has Vercel Hobby's
 * daily CRON available (see app/api/cron/daily-platform/route.ts), which is
 * far coarser than the admin-configurable refresh interval (default 6h).
 * Rather than depend on CRON cadence at all, every price read checks the
 * cached `fetched_at` timestamp against the configured interval and
 * refreshes inline when stale — correct regardless of how often (or
 * whether) any CRON job actually runs. The daily CRON still calls
 * `refreshAllPricesBestEffort()` as a best-effort warm-cache pass so the
 * first real request of the day doesn't pay the live-fetch latency, but
 * it is not required for correctness.
 *
 * @module lib/payments/crypto/priceFeed
 */

import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getManifestValue } from "@/lib/manifest";
import { cryptoPriceFeedBreaker } from "@/lib/payments/circuit";
import type { CryptoCurrency } from "@zobia/types";
import { getToken } from "./tokens";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex/tokens";

const DEFAULT_REFRESH_MINUTES = 360; // 6 hours
const MIN_REFRESH_MINUTES = 5;
const MAX_REFRESH_MINUTES = 7 * 24 * 60; // 7 days

export class PriceFeedUnavailableError extends Error {
  constructor(symbol: string) {
    super(`[crypto/priceFeed] No live or manual price available for ${symbol}`);
    this.name = "PriceFeedUnavailableError";
  }
}

export interface ResolvedPrice {
  usdPrice: Decimal;
  source: "manual" | "live" | "stale-cache";
  fetchedAt: Date;
}

// ---------------------------------------------------------------------------
// Admin-configurable refresh interval
// ---------------------------------------------------------------------------

export async function getPriceRefreshIntervalMinutes(): Promise<number> {
  const raw = await getManifestValue("payment_crypto_price_refresh_minutes");
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= MIN_REFRESH_MINUTES && parsed <= MAX_REFRESH_MINUTES) {
    return parsed;
  }
  return DEFAULT_REFRESH_MINUTES;
}

// ---------------------------------------------------------------------------
// Manual admin override
// ---------------------------------------------------------------------------

interface OverrideRow {
  usd_price: string;
  expires_at: string | null;
}

async function getActiveManualOverride(symbol: CryptoCurrency): Promise<{ usdPrice: Decimal } | null> {
  const { rows } = await db.query<OverrideRow>(
    `SELECT usd_price, expires_at FROM crypto_exchange_rate_overrides WHERE token_symbol = $1 LIMIT 1`,
    [symbol]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  return { usdPrice: new Decimal(row.usd_price) };
}

export async function setManualOverride(
  symbol: CryptoCurrency,
  usdPrice: Decimal | number,
  adminId: string,
  expiresAt: Date | null
): Promise<void> {
  await db.query(
    `INSERT INTO crypto_exchange_rate_overrides (token_symbol, usd_price, set_by_admin_id, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (token_symbol) DO UPDATE
       SET usd_price = EXCLUDED.usd_price,
           set_by_admin_id = EXCLUDED.set_by_admin_id,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
    [symbol, new Decimal(usdPrice).toString(), adminId, expiresAt]
  );
}

export async function clearManualOverride(symbol: CryptoCurrency): Promise<void> {
  await db.query(`DELETE FROM crypto_exchange_rate_overrides WHERE token_symbol = $1`, [symbol]);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheRow {
  usd_price: string;
  source: string;
  fetched_at: string;
}

async function getCachedPrice(symbol: CryptoCurrency): Promise<CacheRow | null> {
  const { rows } = await db.query<CacheRow>(
    `SELECT usd_price, source, fetched_at FROM crypto_price_cache WHERE token_symbol = $1 LIMIT 1`,
    [symbol]
  );
  return rows[0] ?? null;
}

async function writeCachedPrice(symbol: CryptoCurrency, usdPrice: Decimal): Promise<void> {
  await db.query(
    `INSERT INTO crypto_price_cache (token_symbol, usd_price, source, fetched_at)
     VALUES ($1, $2, 'live', NOW())
     ON CONFLICT (token_symbol) DO UPDATE SET usd_price = EXCLUDED.usd_price, source = 'live', fetched_at = NOW()`,
    [symbol, usdPrice.toString()]
  );
}

// ---------------------------------------------------------------------------
// Live fetchers
// ---------------------------------------------------------------------------

async function fetchCoingeckoUsdPrice(coingeckoId: string): Promise<Decimal> {
  return cryptoPriceFeedBreaker.execute(async () => {
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const body = (await res.json()) as Record<string, { usd?: number }>;
    const usd = body[coingeckoId]?.usd;
    if (typeof usd !== "number" || !(usd > 0)) throw new Error("CoinGecko: missing/invalid price");
    return new Decimal(usd);
  });
}

interface DexScreenerPair {
  priceUsd?: string;
  liquidity?: { usd?: number };
  dexId?: string;
}

async function fetchDexScreenerUsdPrice(tokenAddress: string): Promise<Decimal> {
  return cryptoPriceFeedBreaker.execute(async () => {
    const res = await fetch(`${DEXSCREENER_BASE}/${encodeURIComponent(tokenAddress)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`DexScreener ${res.status}`);
    const body = (await res.json()) as { pairs?: DexScreenerPair[] };
    const pairs = body.pairs ?? [];
    if (pairs.length === 0) throw new Error("DexScreener: token not found");
    // Prefer the most liquid pool (most representative price, least
    // susceptible to a thin pool being manipulated).
    const best = pairs
      .filter((p) => p.priceUsd)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!best?.priceUsd) throw new Error("DexScreener: no priced pair");
    const price = new Decimal(best.priceUsd);
    if (!price.isPositive()) throw new Error("DexScreener: non-positive price");
    return price;
  });
}

async function fetchLivePrice(symbol: CryptoCurrency): Promise<Decimal> {
  const token = getToken(symbol);
  if (token.priceFeed.source === "coingecko") {
    return fetchCoingeckoUsdPrice(token.priceFeed.coingeckoId);
  }
  return fetchDexScreenerUsdPrice(token.priceFeed.tokenAddress);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the current USD price for a currency: manual override first (if
 * active), then the cache (refreshed inline if stale), falling back to any
 * last-known cached price (however stale) if the live fetch fails, and only
 * throwing when there is truly nothing to serve.
 */
export async function getUsdPrice(symbol: CryptoCurrency): Promise<ResolvedPrice> {
  const manual = await getActiveManualOverride(symbol);
  if (manual) {
    return { usdPrice: manual.usdPrice, source: "manual", fetchedAt: new Date() };
  }

  const cached = await getCachedPrice(symbol);
  const refreshMinutes = await getPriceRefreshIntervalMinutes();
  const isStale = !cached || Date.now() - new Date(cached.fetched_at).getTime() > refreshMinutes * 60_000;

  if (!isStale && cached) {
    return { usdPrice: new Decimal(cached.usd_price), source: "live", fetchedAt: new Date(cached.fetched_at) };
  }

  try {
    const live = await fetchLivePrice(symbol);
    await writeCachedPrice(symbol, live);
    return { usdPrice: live, source: "live", fetchedAt: new Date() };
  } catch (err) {
    logger.warn(
      { symbol, err: err instanceof Error ? err.message : String(err) },
      "[crypto/priceFeed] Live price fetch failed — falling back to cache/manual"
    );
    if (cached) {
      return { usdPrice: new Decimal(cached.usd_price), source: "stale-cache", fetchedAt: new Date(cached.fetched_at) };
    }
    throw new PriceFeedUnavailableError(symbol);
  }
}

/** Best-effort warm-cache pass, called from the daily platform CRON. Never
 *  throws — a failed refresh for one currency doesn't block the others. */
export async function refreshAllPricesBestEffort(symbols: CryptoCurrency[]): Promise<void> {
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        await getUsdPrice(symbol);
      } catch (err) {
        logger.warn({ symbol, err: err instanceof Error ? err.message : String(err) }, "[crypto/priceFeed] CRON warm-cache refresh failed");
      }
    })
  );
}
