/**
 * lib/portals/cache.ts
 *
 * Two-tier (in-process memory -> Redis -> recompute-on-miss) cache for built
 * portal page payloads, same shape as lib/feed/cache.ts and
 * lib/manifest/index.ts. "Dynamic on first load, then cached": the first
 * visitor to a portal pays for the section queries, everyone else within the
 * TTL gets one Redis GET (or none, if this instance already holds it).
 *
 * Redis cost: at most 1 GET per instance per portal per memory window on a
 * hot portal, 1 SETEX per rebuild. Concurrent misses on one instance share a
 * single in-flight recompute (single-flight) so a burst on a cold portal runs
 * the section queries once.
 */

import { redis } from "@/lib/redis";
import { memDel, memGet, memSet } from "@/lib/cache/memory";
import { logger } from "@/lib/logger";
import { loadManifest } from "@/lib/manifest";

const REDIS_PREFIX = "portal:page:v1:";
/** Memory window is deliberately short: it only absorbs a burst on one instance. */
const MEM_TTL_MS = 20_000;

const _inflight = new Map<string, Promise<unknown>>();

function redisKey(portalId: string): string {
  return `${REDIS_PREFIX}${portalId}`;
}
function memKey(portalId: string): string {
  return `portal:page:mem:${portalId}`;
}

export async function getCachedPortalValue<T>(portalId: string, recompute: () => Promise<T>): Promise<T> {
  const mem = memGet<T>(memKey(portalId));
  if (mem) return mem;

  try {
    const cached = await redis.get(redisKey(portalId));
    if (cached) {
      const value = JSON.parse(cached) as T;
      memSet(memKey(portalId), value, MEM_TTL_MS);
      return value;
    }
  } catch (err) {
    logger.error({ err, portalId }, "[portals] Redis read failed — recomputing");
  }

  const existing = _inflight.get(portalId) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      const value = await recompute();
      memSet(memKey(portalId), value, MEM_TTL_MS);
      try {
        const manifest = await loadManifest();
        await redis.setex(redisKey(portalId), Math.max(30, manifest.portals.cacheTtlSeconds), JSON.stringify(value));
      } catch (err) {
        logger.error({ err, portalId }, "[portals] Redis write failed (non-fatal)");
      }
      return value;
    } finally {
      setTimeout(() => _inflight.delete(portalId), 0);
    }
  })();
  _inflight.set(portalId, promise);
  return promise;
}

/** Drop a portal's cached payload (admin edits, merges). Best-effort on Redis. */
export async function invalidatePortalCache(portalId: string): Promise<void> {
  memDel(memKey(portalId));
  try {
    await redis.del(redisKey(portalId));
  } catch (err) {
    logger.error({ err, portalId }, "[portals] Redis invalidate failed (non-fatal, TTL will expire it)");
  }
}
