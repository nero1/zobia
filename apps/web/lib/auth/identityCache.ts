/**
 * lib/auth/identityCache.ts
 *
 * Short-lived client cache for the two identity endpoints every screen reads:
 * GET /api/users/me (profile) and GET /api/auth/me (session).
 *
 * Why: on Vercel's Fluid compute every request is billed Active CPU (function
 * start-up plus the handler, roughly 20 to 80 ms each). More than fifty
 * components fetched /api/users/me on mount with no sharing, so a single
 * visit to /home cost three or four identical requests, and every client-side
 * navigation repeated them. With this cache a session costs about one request
 * per minute per endpoint.
 *
 * Semantics:
 * - Only exact GETs of the two paths (no query string) are cached.
 * - Concurrent callers share one in-flight request.
 * - A successful (2xx) response is reused for IDENTITY_TTL_MS; errors are
 *   never cached, so a 401 always reaches the caller fresh.
 * - The whole cache is dropped on any write (non-GET) to a same-origin /api
 *   route, on logout and on any 401, so balances, XP or profile edits are
 *   never served stale after the user changes something. A response that
 *   started before such an invalidation is returned to its callers but not
 *   stored.
 * - Memory only (never localStorage): a hard reload or another user signing
 *   in on the same device always starts empty.
 *
 * Each caller gets its own fresh Response object, so existing
 * `fetch(...).then((r) => r.json())` call sites keep working unchanged.
 */

export const IDENTITY_TTL_MS = 60_000;

const CACHEABLE_PATHS = new Set(["/api/users/me", "/api/auth/me"]);

interface Snapshot {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

const cache = new Map<string, { snapshot: Snapshot; at: number }>();
const inflight = new Map<string, Promise<Snapshot>>();
let generation = 0;

/** Returns the cache key (pathname) when this request is a cacheable identity GET. */
export function identityCacheKey(url: URL, method: string | undefined): string | null {
  if ((method ?? "GET").toUpperCase() !== "GET") return null;
  if (url.search) return null;
  return CACHEABLE_PATHS.has(url.pathname) ? url.pathname : null;
}

function toResponse(s: Snapshot): Response {
  return new Response(s.status === 204 ? null : s.body, {
    status: s.status,
    statusText: s.statusText,
    headers: s.headers,
  });
}

/**
 * Serve `key` from cache, joining an in-flight request when there is one,
 * otherwise run `doFetch` and remember a successful result.
 */
export async function cachedIdentityFetch(key: string, doFetch: () => Promise<Response>): Promise<Response> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return toResponse(hit.snapshot);

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
        if (res.ok && startedAt === generation) {
          cache.set(key, { snapshot, at: Date.now() });
        }
        return snapshot;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }
  return toResponse(await pending);
}

/** Drop everything cached (call after writes, logout, 401). */
export function invalidateIdentityCache(): void {
  generation += 1;
  cache.clear();
  inflight.clear();
}
