"use client";
import {AdViewPool} from "@zobia/shared/utils";

/**
 * lib/ads/clientServe.ts
 *
 * Client-side ad fetching for <AdSlot>: slots that mount in the same tick
 * share ONE GET /api/ads/serve?placements=... request, and each placement's
 * answer is kept for AD_TTL_MS so navigating back to a page does not
 * re-request it. Every request is billed Vercel Active CPU; previously each
 * slot fetched on every mount (149 requests in one tester's 12 hours).
 *
 * Memory only. Dropped whenever the client read cache is (any state-changing
 * write such as a plan upgrade, logout, 401, pull-to-refresh).
 */

import { onReadCacheInvalidate } from "@/lib/cache/readCache";

export interface ClientServedAd {
  receipt: string;
  viewReceipts?:string[];
  creativeId: string;
  campaignId: string;
  placementKey: string;
  format: "html" | "text" | "image" | "native" | "third_party";
  size: "300x250" | "320x50" | "interstitial" | "rewarded" | "native";
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  clickUrl: string | null;
  ctaLabel: string | null;
  advertiserName: string;
  advertiserAvatarUrl: string | null;
  thirdPartyTag?: string | null;
}

export const AD_TTL_MS = 5 * 60_000;
const MAX_PER_REQUEST = 10;

const cache=new AdViewPool<ClientServedAd>(AD_TTL_MS);
let queue = new Map<string, Array<(ad: ClientServedAd | null) => void>>();
let flushScheduled = false;
let generation = 0;

async function flush(): Promise<void> {
  flushScheduled = false;
  const batch = queue;
  queue = new Map();
  const startedAt = generation;
  const placements = Array.from(batch.keys());

  for (let i = 0; i < placements.length; i += MAX_PER_REQUEST) {
    const chunk = placements.slice(i, i + MAX_PER_REQUEST);
    let ads: Record<string, ClientServedAd | null> = {};
    let loaded=false;
    try {
      const res = await fetch(`/api/ads/serve?placements=${encodeURIComponent(chunk.join(","))}`, {
        credentials: "include",
      });
      if (res.ok) {
        loaded=true;
        const body = (await res.json()) as { data?: { ads?: Record<string, ClientServedAd | null> } } | null;
        ads = body?.data?.ads ?? {};
        if (startedAt === generation) {
          for (const p of chunk) cache.put(p,ads[p]??null);
        }
      }
    } catch {
      // Network failure: render nothing this time, retry on next mount.
    }
    for(const p of chunk)for(const resolve of batch.get(p)??[]){
      if(!loaded || startedAt!==generation){resolve(null);continue;}
      const ad=cache.take(p);
      if(ad===undefined){void requestAd(p).then(resolve);}else resolve(ad);
    }
  }
}

/** The ad to show for `placement` (null = show nothing / fallback). */
export function requestAd(placement: string): Promise<ClientServedAd | null> {
  const hit=cache.take(placement);
  if(hit!==undefined)return Promise.resolve(hit);

  return new Promise((resolve) => {
    const waiters = queue.get(placement) ?? [];
    waiters.push(resolve);
    queue.set(placement, waiters);
    if (!flushScheduled) {
      flushScheduled = true;
      // Let every slot rendered in this commit enqueue before sending.
      setTimeout(() => void flush(), 0);
    }
  });
}

/** Forget cached ads (logout, plan change). */
export function invalidateAdCache(): void {
  generation += 1;
  cache.clear();
}

onReadCacheInvalidate(invalidateAdCache);
