/**
 * lib/cache/memory.ts
 *
 * Lightweight in-process LRU + TTL cache for server-side use.
 *
 * REDIS-COST-01: this is the primary defence against Redis command volume.
 * Every Redis read in the app should sit behind it, and `tier: "local"` rate
 * limiters live here exclusively. See docs/HOW-IT-WORKS.md -> Redis Cost
 * Controls.
 *
 * Persists across requests within the same serverless instance lifetime,
 * reducing repeated Redis / DB round-trips for frequently-read data
 * (e.g. app manifest, rate-limit state, leaderboards).
 *
 * NOT shared across serverless instances — only use for data where a
 * short period of staleness per instance is acceptable.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Maximum number of entries before LRU eviction kicks in.
 *
 * REDIS-COST-01 raised this from 500. This cache is now load-bearing for cost,
 * not just latency: it is the sole counter for `tier: "local"` rate limiters
 * (one entry per subject per window) as well as the L1 in front of every Redis
 * read. At 500 entries a burst of distinct users could evict the manifest and
 * other hot singletons within their TTL, sending those reads back to Redis —
 * the exact opposite of the intent. Entries are small (counters and short JSON
 * blobs), so a larger ceiling costs little lambda memory and removes that
 * failure mode.
 */
const MAX_SIZE = 5_000;

const _store = new Map<string, CacheEntry<unknown>>();

/** Prune expired entries and enforce MAX_SIZE via LRU eviction. */
function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of _store.entries()) {
    if (entry.expiresAt <= now) _store.delete(key);
  }
  // LRU eviction: Map iteration order is insertion order; delete oldest first.
  while (_store.size > MAX_SIZE) {
    const oldestKey = _store.keys().next().value;
    if (oldestKey !== undefined) _store.delete(oldestKey);
    else break;
  }
}

// Prune every 60 seconds when the module is active.
if (typeof setInterval !== "undefined") {
  setInterval(pruneExpired, 60_000).unref?.();
}

/**
 * Retrieve a cached value, or undefined if missing / expired.
 */
export function memGet<T>(key: string): T | undefined {
  const entry = _store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    _store.delete(key);
    return undefined;
  }
  // Genuine LRU, not FIFO: re-inserting moves the key to the end of the Map's
  // insertion order, which is what `pruneExpired` evicts from. Without this a
  // frequently-READ but infrequently-WRITTEN entry (the app manifest being the
  // important one) ages out purely because newer keys arrived, even though it
  // is the hottest thing in the cache (REDIS-COST-01).
  _store.delete(key);
  _store.set(key, entry);
  return entry.value;
}

/**
 * Store a value in the cache with a TTL.
 *
 * @param key   - Cache key
 * @param value - Value to cache
 * @param ttlMs - Time to live in milliseconds
 */
export function memSet<T>(key: string, value: T, ttlMs: number): void {
  _store.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (_store.size > MAX_SIZE) pruneExpired();
}

/**
 * Delete a cache entry (e.g. after a mutation invalidates it).
 */
export function memDel(key: string): void {
  _store.delete(key);
}

/**
 * Delete all entries whose keys start with the given prefix.
 */
export function memDelPrefix(prefix: string): void {
  for (const key of _store.keys()) {
    if (key.startsWith(prefix)) _store.delete(key);
  }
}
