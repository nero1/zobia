"use client";

/**
 * components/ads/AdSlot.tsx
 *
 * Provider-pluggable ad slot for web + PWA. Renders nothing unless ads are
 * enabled by the admin (manifest feature `admobAds`). When a Google AdSense
 * client id is configured (NEXT_PUBLIC_ADSENSE_CLIENT), it renders a real
 * AdSense unit; otherwise it renders a labelled placeholder so the placement is
 * visible during development. Premium users can be excluded by passing
 * `hideForPremium` once a plan signal is wired in.
 *
 * Usage: <AdSlot placement="games-directory" />
 */

import { useEffect, useRef, useState } from "react";

interface AdSlotProps {
  placement: string;
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export default function AdSlot({ placement, className }: AdSlotProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const insRef = useRef<HTMLModElement>(null);
  const adsenseClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  const adsenseSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config/games")
      .then((r) => r.json())
      .then((b) => {
        if (!cancelled) setEnabled(Boolean(b?.data?.adsEnabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (enabled && adsenseClient && adsenseSlot && insRef.current) {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        /* AdSense script not loaded — ignore */
      }
    }
  }, [enabled, adsenseClient, adsenseSlot]);

  if (!enabled) return null;

  if (adsenseClient && adsenseSlot) {
    return (
      <ins
        ref={insRef}
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

  return (
    <div
      className={`flex h-20 w-full items-center justify-center rounded-lg border border-dashed border-neutral-600 bg-neutral-800/40 text-xs text-neutral-500 ${className ?? ""}`}
      data-ad-placement={placement}
      aria-hidden
    >
      Advertisement
    </div>
  );
}
