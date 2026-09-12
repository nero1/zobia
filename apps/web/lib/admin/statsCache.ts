/**
 * lib/admin/statsCache.ts
 *
 * 30-minute Redis cache for the /gate44/data-management quick-stat cards.
 *
 * Deliberately simple (get/setex only, one key per tab) to stay frugal with
 * Redis calls on a free-tier plan: each tab is at most one GET per page load
 * (cache hit) or one GET + one SETEX (cache miss / live refresh) — no
 * polling, no live updates, no `KEYS` scans.
 */

import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const STATS_CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

function cacheKey(tab: string): string {
  return `admin:dm:stats:${tab}`;
}

export interface CachedStatsResult<T> {
  data: T;
  cachedAt: string;
  isLive: boolean;
}

interface CacheEnvelope<T> {
  data: T;
  cachedAt: string;
}

/**
 * Fetch a tab's stats, preferring the 30-minute Redis cache.
 *
 * - `opts.live === true`: always recompute via `compute()` and overwrite the
 *   cache (used by the "Refresh live data" button). Returns `isLive: true`.
 * - otherwise: try the cache first; on a miss (or a corrupt/unparseable
 *   cache entry), compute and populate the cache. Returns `isLive: false`.
 *
 * A Redis outage never breaks the page: cache reads/writes are best-effort
 * and fall through to `compute()` on any error.
 */
export async function getCachedStats<T>(
  tab: string,
  compute: () => Promise<T>,
  opts: { live?: boolean } = {}
): Promise<CachedStatsResult<T>> {
  const key = cacheKey(tab);

  if (!opts.live) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached) as CacheEnvelope<T>;
        if (parsed && typeof parsed.cachedAt === "string") {
          return { data: parsed.data, cachedAt: parsed.cachedAt, isLive: false };
        }
      }
    } catch (err) {
      logger.warn({ err, tab }, "[admin/statsCache] cache read failed, falling through to compute");
    }
  }

  const data = await compute();
  const cachedAt = new Date().toISOString();

  try {
    await redis.setex(key, STATS_CACHE_TTL_SECONDS, JSON.stringify({ data, cachedAt }));
  } catch (err) {
    logger.warn({ err, tab }, "[admin/statsCache] cache write failed");
  }

  return { data, cachedAt, isLive: !!opts.live };
}
