/**
 * lib/cache/readCache.ts
 *
 * Short-lived, memory-only client cache for a fixed list of GET endpoints
 * that many components read on mount (identity, home widgets, the
 * notification badge, ad slots). Applied transparently by the global fetch
 * guard (lib/auth/sessionExpiredBus.ts), so existing
 * `fetch(...).then((r) => r.json())` call sites need no changes.
 *
 * Why: on Vercel's Fluid compute every request is billed Active CPU
 * (function start-up plus the handler, roughly 20 to 80 ms each). One
 * tester's 12-hour Observability window showed /api/users/me 167 times,
 * /api/auth/me 75 times and every home widget ~25 times: the same data
 * re-requested on every mount and every visit to /home.
 *
 * Semantics:
 * - Only GETs whose path is in READ_CACHE_POLICIES (and whose query string
 *   the policy accepts) are cached; the key is path + query.
 * - Concurrent callers share one in-flight request.
 * - A 2xx answer is reused for the policy's TTL; errors are never cached.
 * - Everything is dropped on any write (non-GET) to a same-origin /api
 *   route, on logout and on any 401, so balances, XP, quest progress or
 *   profile edits never show stale after the user does something. An answer
 *   that was in flight during a drop is returned but not stored.
 * - Pull-to-refresh calls invalidateReadCache() before refetching.
 * - Memory only (never localStorage): a reload, or another user signing in
 *   on the same device, always starts empty.
 * - Each caller receives its own fresh Response object.
 */

interface ReadCachePolicy {
  ttlMs: number;
  /** Accept a query string? Defaults to "no query string only". */
  query?: (params: URLSearchParams) => boolean;
}

const MINUTE = 60_000;

export const READ_CACHE_POLICIES: Readonly<Record<string, ReadCachePolicy>> = {
  // Identity and session: read by 50+ components.
  "/api/users/me": { ttlMs: MINUTE },
  "/api/auth/me": { ttlMs: MINUTE },
  // Home dashboard widgets.
  "/api/presence": { ttlMs: MINUTE },
  "/api/friends/online": { ttlMs: MINUTE },
  "/api/quests/daily": { ttlMs: 2 * MINUTE },
  "/api/quests/new-member": { ttlMs: 2 * MINUTE },
  "/api/leaderboards/me": { ttlMs: 5 * MINUTE },
  "/api/nemesis": { ttlMs: 5 * MINUTE },
  "/api/events": { ttlMs: 5 * MINUTE },
  "/api/creator-spotlight": { ttlMs: 10 * MINUTE },
  "/api/guilds/discovery": { ttlMs: 10 * MINUTE },
  "/api/notices": { ttlMs: 10 * MINUTE },
  "/api/feed/zobian-of-month": { ttlMs: 60 * MINUTE },
  "/api/config/rewards-ui": { ttlMs: 60 * MINUTE },
  // Bell badge and "new" dot: only the single-item probes, never the
  // notifications page's own list.
  "/api/notifications": {
    ttlMs: MINUTE,
    query: (p) => p.get("limit") === "1" && !p.has("after"),
  },
  // Ad slots: one served ad per placement is reused for a few minutes;
  // impressions are still recorded per render by adEventQueue.
  "/api/ads/serve": {
    ttlMs: 5 * MINUTE,
    query: (p) => p.has("placement") || p.has("placements"),
  },
};

/**
 * Background writes that cannot change anything this cache holds (ad
 * impression beacons, the presence heartbeat, referral visit counts, CSP
 * reports). They fire constantly, so letting them clear the cache would
 * defeat it.
 */
const CACHE_NEUTRAL_WRITES = new Set([
  "/api/ads/events",
  "/api/presence",
  "/api/referrals/visit",
  "/api/security/csp-report",
]);

/** True when a write to `pathname` should clear the read cache. */
export function writeInvalidatesReadCache(pathname: string): boolean {
  return !CACHE_NEUTRAL_WRITES.has(pathname);
}

type InvalidateListener = () => void;
const invalidateListeners = new Set<InvalidateListener>();

/** Run `cb` whenever the read cache is dropped (e.g. lib/ads/clientServe.ts). */
export function onReadCacheInvalidate(cb: InvalidateListener): () => void {
  invalidateListeners.add(cb);
  return () => {
    invalidateListeners.delete(cb);
  };
}

interface Snapshot {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

const cache = new Map<string, { snapshot: Snapshot; at: number; ttlMs: number }>();
const inflight = new Map<string, Promise<Snapshot>>();
let generation = 0;

/** Cache key (path + query) when this request is cacheable, else null. */
export function readCacheKey(url: URL, method: string | undefined): string | null {
  if ((method ?? "GET").toUpperCase() !== "GET") return null;
  const policy = READ_CACHE_POLICIES[url.pathname];
  if (!policy) return null;
  if (url.search) {
    if (!policy.query || !policy.query(url.searchParams)) return null;
  }
  return url.pathname + url.search;
}

function toResponse(s: Snapshot): Response {
  return new Response(s.status === 204 || s.status === 304 ? null : s.body, {
    status: s.status,
    statusText: s.statusText,
    headers: s.headers,
  });
}

function ttlFor(key: string): number {
  const path = key.split("?")[0];
  return READ_CACHE_POLICIES[path]?.ttlMs ?? 0;
}

/**
 * Serve `key` from cache, joining an in-flight request when there is one,
 * otherwise run `doFetch` and remember a successful result.
 */
export async function cachedRead(key: string, doFetch: () => Promise<Response>): Promise<Response> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttlMs) return toResponse(hit.snapshot);

  let pending = inflight.get(key);
  if (!pending) {
    const startedAt = generation;
    pending = doFetch()
      .then(async (res): Promise<Snapshot> => {
        const snapshot: Snapshot = {
          status: res.status,
          statusText: res.statusText,
          headers: Array.from(res.headers.entries()),
          body: await res.text(),
        };
        const ttlMs = ttlFor(key);
        if (res.ok && ttlMs > 0 && startedAt === generation) {
          cache.set(key, { snapshot, at: Date.now(), ttlMs });
        }
        return snapshot;
      })
      .finally(() => {
        if (inflight.get(key) === pending) inflight.delete(key);
      });
    inflight.set(key, pending);
  }
  return toResponse(await pending);
}

/** Drop everything cached (call after writes, logout, 401, pull-to-refresh). */
export function invalidateReadCache(): void {
  generation += 1;
  cache.clear();
  inflight.clear();
  invalidateListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // a listener must never break invalidation
    }
  });
}
