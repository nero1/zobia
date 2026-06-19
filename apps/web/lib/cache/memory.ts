/**
 * lib/cache/memory.ts
 *
 * Lightweight in-process TTL cache for server-side use.
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

const _store = new Map<string, CacheEntry<unknown>>();

/** Prune expired entries to prevent unbounded memory growth. */
function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of _store.entries()) {
    if (entry.expiresAt <= now) _store.delete(key);
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
