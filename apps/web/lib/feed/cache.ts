/**
 * lib/feed/cache.ts
 *
 * Two-tier (in-process memory → Redis → recompute-on-miss) cache for Home
 * Feed candidate pools, mirroring the exact pattern used by
 * lib/manifest/index.ts (MEM_CACHE_KEY/MEM_CACHE_TTL_MS + CACHE_KEY/
 * CACHE_TTL_SECONDS + single-flight dedup) — Redis calls must stay minimal
 * (free-tier Redis), and the pool only needs to be as fresh as
 * homeFeed.cacheTtlSeconds (10-15 min staleness is fine).
 *
 * Normal path: the /api/cron/feed-refresh job calls setCandidatePool() every
 * 10-15 minutes (external cron-jobs.org trigger — NOT in vercel.json, see
 * that route's header). Per-request reads (getCandidatePool) should always
 * hit the memory or Redis cache; the recompute-on-miss fallback passed in by
 * the caller only fires if the CRON has never run yet or Redis is cold,
 * so a request is never left with an empty feed.
 */

import { redis } from "@/lib/redis";
import { memGet, memSet } from "@/lib/cache/memory";
import { logger } from "@/lib/logger";
import { loadManifest } from "@/lib/manifest";
import type { FeedItem } from "./types";

type PoolKind = "for_you" | "trending";

const REDIS_KEY_PREFIX = "feed:pool:v1:";
/** In-process cache is intentionally short — just long enough to absorb a burst of concurrent requests on one instance. */
const MEM_CACHE_TTL_MS = 15_000;

const _inflight = new Map<PoolKind, Promise<FeedItem[]>>();

function memKey(kind: PoolKind): string {
  return `feed:pool:mem:${kind}`;
}

export async function setCandidatePool(kind: PoolKind, items: FeedItem[]): Promise<void> {
  memSet(memKey(kind), items, MEM_CACHE_TTL_MS);
  try {
    const manifest = await loadManifest();
    await redis.setex(`${REDIS_KEY_PREFIX}${kind}`, manifest.homeFeed.cacheTtlSeconds, JSON.stringify(items));
  } catch (err) {
    logger.error({ err, kind }, "[feed] Failed to write candidate pool to Redis (non-fatal)");
  }
}

/**
 * Read the cached pool for `kind`. On a full cache miss (cold Redis AND no
 * CRON run yet), falls back to `recompute` — single-flighted so concurrent
 * requests during that rare cold-start window share one computation instead
 * of each running the full cross-table aggregation.
 */
export async function getCandidatePool(kind: PoolKind, recompute: () => Promise<FeedItem[]>): Promise<FeedItem[]> {
  const mem = memGet<FeedItem[]>(memKey(kind));
  if (mem) return mem;

  try {
    const cached = await redis.get(`${REDIS_KEY_PREFIX}${kind}`);
    if (cached) {
      const items = JSON.parse(cached) as FeedItem[];
      memSet(memKey(kind), items, MEM_CACHE_TTL_MS);
      return items;
    }
  } catch (err) {
    logger.error({ err, kind }, "[feed] Redis read failed for candidate pool — falling back to recompute");
  }

  const existing = _inflight.get(kind);
  if (existing) return existing;

  const promise = (async () => {
    try {
      logger.info({ kind }, "[feed] candidate pool cache miss — recomputing synchronously (should only happen before the first CRON run)");
      const items = await recompute();
      await setCandidatePool(kind, items);
      return items;
    } finally {
      setTimeout(() => _inflight.delete(kind), 0);
    }
  })();
  _inflight.set(kind, promise);
  return promise;
}
