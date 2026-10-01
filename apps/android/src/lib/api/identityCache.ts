/**
 * apps/android/src/lib/api/identityCache.ts
 *
 * Short-lived cache for GET /users/me and GET /auth/me on the shared axios
 * client. Mirrors apps/web/lib/auth/identityCache.ts.
 *
 * Why: every request to the web API costs Vercel Fluid Active CPU (function
 * start-up plus the handler). Many screens read /users/me on mount under
 * different React Query keys, so one session repeated the same request many
 * times. With this cache it costs about one request per minute.
 *
 * Semantics:
 * - Only exact GETs of the two paths (no params) are cached, keyed by the
 *   Authorization header so one user's answer is never served to another.
 * - Concurrent callers share one in-flight request; a 2xx answer is reused
 *   for IDENTITY_TTL_MS. Errors are never cached.
 * - Any write (non-GET) through the client, a token change and sign-out drop
 *   the cache; an answer that was in flight during a drop is not stored.
 * - Memory only.
 */

import axios, { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

export const IDENTITY_TTL_MS = 60_000;

const CACHEABLE_URLS = new Set(['/users/me', '/auth/me']);

const cache = new Map<string, { response: AxiosResponse; at: number }>();
const inflight = new Map<string, Promise<AxiosResponse>>();
let generation = 0;

export function isIdentityRead(config: InternalAxiosRequestConfig): boolean {
  const method = (config.method ?? 'get').toLowerCase();
  if (method !== 'get') return false;
  if (config.params && Object.keys(config.params as object).length > 0) return false;
  return CACHEABLE_URLS.has(config.url ?? '');
}

export function isWriteRequest(config: InternalAxiosRequestConfig): boolean {
  const method = (config.method ?? 'get').toLowerCase();
  return method !== 'get' && method !== 'head' && method !== 'options';
}

function cacheKey(config: InternalAxiosRequestConfig): string {
  const auth = String(config.headers?.Authorization ?? '');
  return `${config.url}|${auth}`;
}

/** Each caller gets its own copy, so response interceptors can't mutate the cached one. */
function copy(response: AxiosResponse, config: InternalAxiosRequestConfig): AxiosResponse {
  return { ...response, config, data: structuredClone(response.data) };
}

/** Wraps the client's real adapter with the cache for identity reads. */
export function withIdentityCache(base: AxiosAdapter): AxiosAdapter {
  return async (config) => {
    const key = cacheKey(config);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return copy(hit.response, config);

    let pending = inflight.get(key);
    if (!pending) {
      const startedAt = generation;
      pending = base(config)
        .then((response) => {
          if (startedAt === generation && response.status >= 200 && response.status < 300) {
            cache.set(key, { response, at: Date.now() });
          }
          return response;
        })
        .finally(() => {
          inflight.delete(key);
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
export function invalidateIdentityCache(): void {
  generation += 1;
  cache.clear();
  inflight.clear();
}
