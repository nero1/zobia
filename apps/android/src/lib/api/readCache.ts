/**
 * apps/android/src/lib/api/readCache.ts
 *
 * Short-lived, memory-only cache for a fixed list of hot GET endpoints
 * (identity, home widgets, ad slots) on the shared axios client. Mirrors
 * apps/web/lib/cache/readCache.ts (same endpoints and TTLs).
 *
 * Why: every request to the web API costs Vercel Fluid Active CPU (function
 * start-up plus the handler). Many screens read /users/me on mount under
 * different React Query keys, and every return to Home refetched each
 * widget, so one session repeated the same requests many times.
 *
 * Semantics:
 * - Only GETs whose path is in READ_CACHE_POLICIES (and whose query the
 *   policy accepts) are cached, keyed by URL + query + Authorization header
 *   so one user's answer is never served to another.
 * - Concurrent callers share one in-flight request; a 2xx answer is reused
 *   for the policy's TTL. Errors are never cached.
 * - Any write (non-GET) through the client, a token change and sign-out drop
 *   the cache; an answer that was in flight during a drop is not stored.
 * - Memory only.
 */

import axios, { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

interface ReadCachePolicy {
  ttlMs: number;
  /** Accept a query string? Defaults to "no query string only". */
  query?: (params: URLSearchParams) => boolean;
}

const MINUTE = 60_000;

export const READ_CACHE_POLICIES: Readonly<Record<string, ReadCachePolicy>> = {
  '/users/me': { ttlMs: MINUTE },
  '/auth/me': { ttlMs: MINUTE },
  '/presence': { ttlMs: MINUTE },
  '/friends/online': { ttlMs: MINUTE },
  '/quests/daily': { ttlMs: 2 * MINUTE },
  '/quests/new-member': { ttlMs: 2 * MINUTE },
  '/leaderboards/me': { ttlMs: 5 * MINUTE },
  '/nemesis': { ttlMs: 5 * MINUTE },
  '/events': { ttlMs: 5 * MINUTE },
  '/creator-spotlight': { ttlMs: 10 * MINUTE },
  '/guilds/discovery': { ttlMs: 10 * MINUTE },
  '/notices': { ttlMs: 10 * MINUTE },
  '/feed/zobian-of-month': { ttlMs: 60 * MINUTE },
  '/config/rewards-ui': { ttlMs: 60 * MINUTE },
  '/ads/serve': {
    ttlMs: 5 * MINUTE,
    query: (p) => p.has('placement') || p.has('placements'),
  },
};

const cache = new Map<string, { response: AxiosResponse; at: number; ttlMs: number }>();
const inflight = new Map<string, Promise<AxiosResponse>>();
let generation = 0;

/** Path and merged query (URL query + axios params) of a request. */
function splitUrl(config: InternalAxiosRequestConfig): { path: string; params: URLSearchParams } {
  const [path, qs = ''] = (config.url ?? '').split('?');
  const params = new URLSearchParams(qs);
  if (config.params && typeof config.params === 'object') {
    for (const [k, v] of Object.entries(config.params as Record<string, unknown>)) {
      if (v !== undefined && v !== null) params.append(k, String(v));
    }
  }
  return { path, params };
}

function policyFor(config: InternalAxiosRequestConfig): ReadCachePolicy | null {
  const { path, params } = splitUrl(config);
  const policy = READ_CACHE_POLICIES[path];
  if (!policy) return null;
  if ([...params.keys()].length > 0 && (!policy.query || !policy.query(params))) return null;
  return policy;
}

export function isCacheableRead(config: InternalAxiosRequestConfig): boolean {
  const method = (config.method ?? 'get').toLowerCase();
  return method === 'get' && policyFor(config) !== null;
}

/**
 * Background writes that cannot change anything this cache holds (ad
 * impression batches, the presence heartbeat, referral visits). They fire
 * constantly, so letting them clear the cache would defeat it. Paths are
 * relative to /api.
 */
const CACHE_NEUTRAL_WRITES = new Set(['/ads/events', '/presence', '/referrals/visit']);

/** True when a write to `path` (relative to /api, or a full /api URL) should clear the cache. */
export function writeInvalidatesReadCache(path: string): boolean {
  let p = path.split('?')[0];
  const apiIdx = p.indexOf('/api/');
  if (apiIdx !== -1) p = p.slice(apiIdx + 4);
  return !CACHE_NEUTRAL_WRITES.has(p);
}

/** A state-changing write (non-GET, not a background beacon). */
export function isWriteRequest(config: InternalAxiosRequestConfig): boolean {
  const method = (config.method ?? 'get').toLowerCase();
  if (method === 'get' || method === 'head' || method === 'options') return false;
  return writeInvalidatesReadCache(config.url ?? '');
}

function cacheKey(config: InternalAxiosRequestConfig): string {
  const { path, params } = splitUrl(config);
  const auth = String(config.headers?.Authorization ?? '');
  return `${path}?${params.toString()}|${auth}`;
}

/** Each caller gets its own copy, so response interceptors can't mutate the cached one. */
function copy(response: AxiosResponse, config: InternalAxiosRequestConfig): AxiosResponse {
  return { ...response, config, data: structuredClone(response.data) };
}

/** Wraps the client's real adapter with the read cache. */
export function withReadCache(base: AxiosAdapter): AxiosAdapter {
  return async (config) => {
    const key = cacheKey(config);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttlMs) return copy(hit.response, config);
    const ttlMs = policyFor(config)?.ttlMs ?? 0;

    let pending = inflight.get(key);
    if (!pending) {
      const startedAt = generation;
      pending = base(config)
        .then((response) => {
          if (ttlMs > 0 && startedAt === generation && response.status >= 200 && response.status < 300) {
            cache.set(key, { response, at: Date.now(), ttlMs });
          }
          return response;
        })
        .finally(() => {
          if (inflight.get(key) === pending) inflight.delete(key);
        });
      inflight.set(key, pending);
    }
    return copy(await pending, config);
  };
}

/** Resolve the axios default adapter for this config (xhr/fetch in the WebView). */
export function defaultAdapterFor(config: InternalAxiosRequestConfig): AxiosAdapter {
  return axios.getAdapter(config.adapter ?? axios.defaults.adapter);
}

/** Drop everything cached (call after writes, token changes and sign-out). */
export function invalidateReadCache(): void {
  generation += 1;
  cache.clear();
  inflight.clear();
}
