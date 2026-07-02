"use client";

/**
 * components/ads/AdSlot.tsx
 *
 * Platform ad slot for web + PWA (PRD §17 Pillar 3 — Platform Advertising).
 * Fetches one eligible in-house/user/native/third-party ad for `placement`
 * from GET /api/ads/serve — plan-based ad exposure (Free/Plus/Pro/Max) and
 * budget eligibility are enforced server-side, so this component only has
 * to render (or render nothing). Falls back to a Google AdSense unit when
 * no in-house ad is eligible and an AdSense client id is configured — same
 * fallback the previous placeholder implementation used.
 *
 * Impressions are recorded once per mount via IntersectionObserver
 * (50% visible) and clicks on click-through; both are queued in
 * localStorage and flushed in small batches (adEventQueue.ts) so ad
 * tracking stays offline-friendly and cheap on the API.
 *
 * Usage: <AdSlot placement="feed_banner" />
 */

import { useEffect, useRef, useState } from "react";
import { enqueueAdEvent } from "./adEventQueue";

interface AdSlotProps {
  placement: string;
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

interface ServedAd {
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

const SIZE_CLASS: Record<string, string> = {
  "300x250": "w-[300px] max-w-full h-[250px]",
  "320x50": "w-[320px] max-w-full h-[50px]",
  native: "w-full min-h-[80px]",
  interstitial: "w-full h-full",
  rewarded: "w-full h-full",
};

export default function AdSlot({ placement, className }: AdSlotProps) {
  const [ad, setAd] = useState<ServedAd | null | undefined>(undefined); // undefined = loading
  const containerRef = useRef<HTMLDivElement>(null);
  const impressedRef = useRef(false);
  const adsenseClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  const adsenseSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ads/serve?placement=${encodeURIComponent(placement)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled) return;
        setAd(b?.data?.ad ?? null);
      })
      .catch(() => {
        if (!cancelled) setAd(null);
      });
    return () => {
      cancelled = true;
    };
  }, [placement]);

  useEffect(() => {
    if (!ad || impressedRef.current || !containerRef.current) return;
    const el = containerRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !impressedRef.current) {
          impressedRef.current = true;
          enqueueAdEvent({ creativeId: ad.creativeId, placementKey: ad.placementKey, type: "impression" });
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ad]);

  useEffect(() => {
    if (ad === null && adsenseClient && adsenseSlot) {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        /* AdSense script not loaded — ignore */
      }
    }
  }, [ad, adsenseClient, adsenseSlot]);

  if (ad === undefined) return null; // loading — avoid layout flash

  if (ad === null) {
    if (adsenseClient && adsenseSlot) {
      return (
        <ins
          className={`adsbygoogle block ${className ?? ""}`}
          style={{ display: "block" }}
          data-ad-client={adsenseClient}
          data-ad-slot={adsenseSlot}
          data-ad-format="auto"
          data-full-width-responsive="true"
          data-ad-placement={placement}
        />
      );
    }
    return null;
  }

  function handleClick() {
    if (!ad) return;
    enqueueAdEvent({ creativeId: ad.creativeId, placementKey: ad.placementKey, type: "click" });
  }

  const sizeClass = SIZE_CLASS[ad.size] ?? SIZE_CLASS.native;

  // Untrusted third-party ad network markup renders inside a sandboxed
  // iframe (no same-origin, no top navigation, no forms) — never inline via
  // dangerouslySetInnerHTML, which would run with full page privileges.
  if (ad.format === "third_party" && ad.thirdPartyTag) {
    return (
      <div ref={containerRef} className={`relative overflow-hidden rounded-lg ${sizeClass} ${className ?? ""}`} data-ad-placement={placement}>
        <span className="absolute right-1.5 top-1.5 z-10 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
          Sponsored
        </span>
        <iframe
          title={`ad-${ad.creativeId}`}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-popups"
          srcDoc={ad.thirdPartyTag}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900 ${sizeClass} ${className ?? ""}`}
      data-ad-placement={placement}
    >
      <span className="absolute right-1.5 top-1.5 z-10 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
        Sponsored
      </span>
      <a
        href={ad.clickUrl ?? "#"}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={handleClick}
        className="flex h-full w-full items-center gap-3 p-3 no-underline hover:bg-neutral-50 dark:hover:bg-neutral-800"
      >
        {ad.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" className="h-full max-h-[64px] w-auto shrink-0 rounded object-cover" />
        )}
        <div className="min-w-0 flex-1">
          {ad.title && <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">{ad.title}</p>}
          {ad.body && <p className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{ad.body}</p>}
          <p className="mt-0.5 truncate text-[11px] text-neutral-400">{ad.advertiserName}</p>
        </div>
        {ad.ctaLabel && (
          <span className="shrink-0 rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white">{ad.ctaLabel}</span>
        )}
      </a>
    </div>
  );
}
