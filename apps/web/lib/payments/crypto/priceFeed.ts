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
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

async function getActiveManualOverride(symbol: CryptoCurrency): Promise<{ usdPrice: Decimal } | null> {
  const orm = await getDb();
  const rows = await orm
    .select({ usdPrice: schema.cryptoExchangeRateOverrides.usdPrice, expiresAt: schema.cryptoExchangeRateOverrides.expiresAt })
    .from(schema.cryptoExchangeRateOverrides)
    .where(eq(schema.cryptoExchangeRateOverrides.tokenSymbol, symbol))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  return { usdPrice: new Decimal(row.usdPrice) };
}

export async function setManualOverride(
  symbol: CryptoCurrency,
  usdPrice: Decimal | number,
  adminId: string,
  expiresAt: Date | null
): Promise<void> {
  const orm = await getDb();
  const value = new Decimal(usdPrice).toString();
  await orm
    .insert(schema.cryptoExchangeRateOverrides)
    .values({
      tokenSymbol: symbol,
      usdPrice: value,
      setByAdminId: adminId,
      expiresAt,
      updatedAt: sql`NOW()`,
    })
    .onConflictDoUpdate({
      target: schema.cryptoExchangeRateOverrides.tokenSymbol,
      set: {
        usdPrice: value,
        setByAdminId: adminId,
        expiresAt,
        updatedAt: sql`NOW()`,
      },
    });
}

export async function clearManualOverride(symbol: CryptoCurrency): Promise<void> {
  const orm = await getDb();
  await orm.delete(schema.cryptoExchangeRateOverrides).where(eq(schema.cryptoExchangeRateOverrides.tokenSymbol, symbol));
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheRow {
  usdPrice: string;
  source: string;
  fetchedAt: Date;
}

async function getCachedPrice(symbol: CryptoCurrency): Promise<CacheRow | null> {
  const orm = await getDb();
  const rows = await orm
    .select({
      usdPrice: schema.cryptoPriceCache.usdPrice,
      source: schema.cryptoPriceCache.source,
      fetchedAt: schema.cryptoPriceCache.fetchedAt,
    })
    .from(schema.cryptoPriceCache)
    .where(eq(schema.cryptoPriceCache.tokenSymbol, symbol))
    .limit(1);
  return rows[0] ?? null;
}

async function writeCachedPrice(symbol: CryptoCurrency, usdPrice: Decimal): Promise<void> {
  const orm = await getDb();
  const value = usdPrice.toString();
  await orm
    .insert(schema.cryptoPriceCache)
    .values({ tokenSymbol: symbol, usdPrice: value, source: "live", fetchedAt: sql`NOW()` })
    .onConflictDoUpdate({
      target: schema.cryptoPriceCache.tokenSymbol,
      set: { usdPrice: value, source: "live", fetchedAt: sql`NOW()` },
    });
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
  const isStale = !cached || Date.now() - cached.fetchedAt.getTime() > refreshMinutes * 60_000;

  if (!isStale && cached) {
    return { usdPrice: new Decimal(cached.usdPrice), source: "live", fetchedAt: cached.fetchedAt };
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
      return { usdPrice: new Decimal(cached.usdPrice), source: "stale-cache", fetchedAt: cached.fetchedAt };
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
