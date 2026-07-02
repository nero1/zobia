/**
 * apps/android/src/components/ads/AdSlot.tsx
 *
 * In-house/user/native ad slot — mirrors apps/web/components/ads/AdSlot.tsx
 * so the Android app's UI matches mobile web/PWA (PRD: "the capacitor app
 * should mirror as close as possible the ui of the mobile web and pwa").
 * AdMob (banner/interstitial/rewarded) is additive on top of this via
 * lib/ads/admob.ts, shown alongside these in-house/third-party ads rather
 * than replacing them.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Browser } from '@capacitor/browser';
import { apiClient } from '@/lib/api/client';

interface ServedAd {
  creativeId: string;
  campaignId: string;
  placementKey: string;
  format: string;
  size: '300x250' | '320x50' | 'interstitial' | 'rewarded' | 'native';
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  clickUrl: string | null;
  ctaLabel: string | null;
  advertiserName: string;
}

async function fetchAd(placement: string): Promise<ServedAd | null> {
  const { data } = await apiClient.get<{ ad: ServedAd | null }>(`/ads/serve?placement=${encodeURIComponent(placement)}`);
  return data.ad;
}

async function reportEvent(creativeId: string, placementKey: string, type: 'impression' | 'click') {
  try {
    await apiClient.post('/ads/events', {
      events: [{ creativeId, placementKey, type, clientEventId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }],
    });
  } catch {
    /* best-effort — a missed impression report is not worth retry complexity on mobile */
  }
}

const SIZE_CLASS: Record<string, string> = {
  '300x250': 'w-[300px] max-w-full h-[250px]',
  '320x50': 'w-full h-[50px]',
  native: 'w-full min-h-[64px]',
};

export default function AdSlot({ placement, className }: { placement: string; className?: string }) {
  const { data: ad } = useQuery({ queryKey: ['ads', 'serve', placement], queryFn: () => fetchAd(placement) });
  const impressedRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ad || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible(true);
      },
      { threshold: 0.5 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ad]);

  useEffect(() => {
    if (visible && ad && !impressedRef.current) {
      impressedRef.current = true;
      void reportEvent(ad.creativeId, ad.placementKey, 'impression');
    }
  }, [visible, ad]);

  if (!ad) return null;

  return (
    <div ref={ref} className={`relative overflow-hidden rounded-lg border border-neutral-200 bg-white ${SIZE_CLASS[ad.size] ?? SIZE_CLASS.native} ${className ?? ''}`}>
      <span className="absolute right-1.5 top-1.5 z-10 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">Sponsored</span>
      {/*
        Not a plain <a target="_blank"> — a Capacitor WebView has no concept
        of "new tab", so that would navigate the app itself away to the ad's
        destination. Browser.open() matches the in-app-browser pattern used
        everywhere else in this app (OAuth, Play Store purchase fallbacks).
      */}
      <button
        type="button"
        onClick={() => {
          void reportEvent(ad.creativeId, ad.placementKey, 'click');
          if (ad.clickUrl) void Browser.open({ url: ad.clickUrl });
        }}
        className="flex h-full w-full items-center gap-3 p-3 text-left"
      >
        {ad.imageUrl && <img src={ad.imageUrl} alt="" className="h-full max-h-[64px] w-auto shrink-0 rounded object-cover" />}
        <div className="min-w-0 flex-1">
          {ad.title && <p className="truncate text-sm font-semibold text-neutral-900">{ad.title}</p>}
          {ad.body && <p className="line-clamp-2 text-xs text-neutral-500">{ad.body}</p>}
          <p className="mt-0.5 truncate text-[11px] text-neutral-400">{ad.advertiserName}</p>
        </div>
        {ad.ctaLabel && <span className="shrink-0 rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white">{ad.ctaLabel}</span>}
      </button>
    </div>
  );
}
