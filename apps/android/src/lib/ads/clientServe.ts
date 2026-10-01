/**
 * apps/android/src/lib/ads/clientServe.ts
 *
 * Batches ad requests: <AdSlot>s that mount in the same tick share ONE
 * GET /api/ads/serve?placements=... request (Vercel bills every request as
 * Active CPU). Mirrors apps/web/lib/ads/clientServe.ts. Per-placement
 * caching is left to React Query (AdSlot's staleTime) and the axios read
 * cache (lib/api/readCache.ts).
 */

import { apiClient } from '@/lib/api/client';

const MAX_PER_REQUEST = 10;

type Resolver = { resolve: (ad: unknown) => void; reject: (err: unknown) => void };

let queue = new Map<string, Resolver[]>();
let flushScheduled = false;

async function flush(): Promise<void> {
  flushScheduled = false;
  const batch = queue;
  queue = new Map();
  const placements = Array.from(batch.keys());
  for (let i = 0; i < placements.length; i += MAX_PER_REQUEST) {
    const chunk = placements.slice(i, i + MAX_PER_REQUEST);
    try {
      const { data } = await apiClient.get<{ ads?: Record<string, unknown> }>(
        `/ads/serve?placements=${encodeURIComponent(chunk.join(','))}`,
      );
      const ads = data?.ads ?? {};
      for (const p of chunk) for (const w of batch.get(p) ?? []) w.resolve(ads[p] ?? null);
    } catch (err) {
      for (const p of chunk) for (const w of batch.get(p) ?? []) w.reject(err);
    }
  }
}

/** The served ad for `placement`, or null. Batched with other slots mounting now. */
export function requestAd<T>(placement: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const waiters = queue.get(placement) ?? [];
    waiters.push({ resolve: resolve as (ad: unknown) => void, reject });
    queue.set(placement, waiters);
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(() => void flush(), 0);
    }
  });
}
