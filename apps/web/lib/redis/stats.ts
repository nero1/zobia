/**
 * lib/redis/stats.ts
 *
 * Cache hit ratio for the /gate44/monitoring dashboard, read from Redis's
 * own `INFO stats` counters (`keyspace_hits` / `keyspace_misses`).
 *
 * Zero added overhead: Redis already increments these counters on every
 * command it processes as part of normal operation — nothing new is being
 * tracked. The only cost is the occasional `INFO` call itself, which the
 * caller (lib/admin/statsCache.ts, 30-minute cache) keeps rare.
 */

import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export interface CacheHitStats {
  available: boolean;
  hits: number;
  misses: number;
  /** 0-100, or null when there's no traffic yet to compute a ratio from. */
  hitRatioPercent: number | null;
}

function parseInfoInt(info: string, key: string): number {
  const match = info.match(new RegExp(`^${key}:(\\d+)`, "m"));
  return match ? parseInt(match[1], 10) : 0;
}

export async function getCacheHitStats(): Promise<CacheHitStats> {
  try {
    const info = await redis.info("stats");
    const hits = parseInfoInt(info, "keyspace_hits");
    const misses = parseInfoInt(info, "keyspace_misses");
    const total = hits + misses;
    return {
      available: true,
      hits,
      misses,
      hitRatioPercent: total > 0 ? Math.round((hits / total) * 10_000) / 100 : null,
    };
  } catch (err) {
    logger.warn({ err }, "[redis/stats] INFO stats unavailable");
    return { available: false, hits: 0, misses: 0, hitRatioPercent: null };
  }
}
