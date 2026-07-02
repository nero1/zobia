"use client";

/**
 * components/ads/InterstitialAd.tsx
 *
 * Full-screen interstitial ad (PRD §17 Pillar 3 — ad sizes include "full
 * screen interstitial"). Controlled component: mount with `open` when you
 * want to show one at a natural transition point (e.g. after completing a
 * Quest, leaving a Room). Free-tier only — plan-level gating happens
 * server-side in /api/ads/serve, so if no ad is eligible this renders
 * nothing and calls onClose immediately.
 *
 * Usage:
 *   const [showInterstitial, setShowInterstitial] = useState(false);
 *   {showInterstitial && <InterstitialAd onClose={() => setShowInterstitial(false)} />}
 */

import { useEffect, useRef, useState } from "react";
import { enqueueAdEvent } from "./adEventQueue";

interface ServedAd {
  creativeId: string;
  placementKey: string;
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  clickUrl: string | null;
  ctaLabel: string | null;
  advertiserName: string;
}

const SKIP_AFTER_SECONDS = 5;

export default function InterstitialAd({ onClose }: { onClose: () => void }) {
  const [ad, setAd] = useState<ServedAd | null | undefined>(undefined);
  const [secondsLeft, setSecondsLeft] = useState(SKIP_AFTER_SECONDS);
  const impressedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ads/serve?placement=interstitial_global", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled) return;
        const served = b?.data?.ad ?? null;
        setAd(served);
        if (!served) onClose();
      })
      .catch(() => {
        if (!cancelled) {
          setAd(null);
          onClose();
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ad || impressedRef.current) return;
    impressedRef.current = true;
    enqueueAdEvent({ creativeId: ad.creativeId, placementKey: ad.placementKey, type: "impression" });
  }, [ad]);

  useEffect(() => {
    if (!ad) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [ad]);

  if (!ad) return null;

  function handleClick() {
    if (!ad) return;
    enqueueAdEvent({ creativeId: ad.creativeId, placementKey: ad.placementKey, type: "click" });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white dark:bg-neutral-900">
        <span className="absolute left-2 top-2 z-10 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          Sponsored
        </span>
        <button
          onClick={onClose}
          disabled={secondsLeft > 0}
          aria-label="Close ad"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-sm font-bold text-white disabled:opacity-70"
        >
          {secondsLeft > 0 ? secondsLeft : "✕"}
        </button>
        <a href={ad.clickUrl ?? "#"} target="_blank" rel="noopener noreferrer sponsored" onClick={handleClick} className="block no-underline">
          {ad.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.imageUrl} alt="" className="h-64 w-full object-cover" />
          )}
          <div className="p-4">
            {ad.title && <p className="text-base font-bold text-neutral-900 dark:text-neutral-50">{ad.title}</p>}
            {ad.body && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{ad.body}</p>}
            <p className="mt-2 text-xs text-neutral-400">{ad.advertiserName}</p>
            {ad.ctaLabel && (
              <span className="mt-3 block rounded-full bg-primary-600 py-2 text-center text-sm font-semibold text-white">{ad.ctaLabel}</span>
            )}
          </div>
        </a>
      </div>
    </div>
  );
}
