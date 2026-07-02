"use client";

/**
 * components/ads/RewardedAdButton.tsx
 *
 * "Watch an ad, earn Credits" button (PRD §11/§17 — free & Plus plan users,
 * capped at `ad_rewarded_daily_cap`/day, PRD default 5). Shows the
 * `rewarded_global` placement ad for a few seconds (simulating watch-to-
 * completion — on Android the Capacitor AdMob rewarded unit drives this
 * instead, see apps/android/src/lib/ads/admob.ts), then claims the coin
 * bonus via the existing POST /api/economy/rewards/ad-reward endpoint.
 */

import { useEffect, useRef, useState } from "react";
import { enqueueAdEvent } from "./adEventQueue";

interface ServedAd {
  creativeId: string;
  placementKey: string;
  title: string | null;
  imageUrl: string | null;
  advertiserName: string;
}

const WATCH_SECONDS = 5;

export default function RewardedAdButton({ onRewarded }: { onRewarded?: (coinsAwarded: number) => void }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "watching" | "claiming" | "error">("idle");
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(WATCH_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const impressedRef = useRef(false);

  async function start() {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/ads/serve?placement=rewarded_global", { credentials: "include" });
      const body = await res.json();
      const served = body?.data?.ad ?? null;
      if (!served) {
        setError("No rewarded ad is available right now — try again later.");
        setPhase("error");
        return;
      }
      setAd(served);
      setSecondsLeft(WATCH_SECONDS);
      setPhase("watching");
    } catch {
      setError("Failed to load ad.");
      setPhase("error");
    }
  }

  useEffect(() => {
    if (phase !== "watching" || !ad) return;
    if (!impressedRef.current) {
      impressedRef.current = true;
      enqueueAdEvent({ creativeId: ad.creativeId, placementKey: ad.placementKey, type: "impression" });
    }
    if (secondsLeft <= 0) {
      void claim();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secondsLeft, ad]);

  async function claim() {
    setPhase("claiming");
    try {
      const res = await fetch("/api/economy/rewards/ad-reward", { method: "POST", credentials: "include" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not claim reward.");
        setPhase("error");
        return;
      }
      onRewarded?.(body.data.coinsAwarded);
      setPhase("idle");
      setAd(null);
      impressedRef.current = false;
    } catch {
      setError("Could not claim reward.");
      setPhase("error");
    }
  }

  if (phase === "watching" && ad) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center dark:border-neutral-700 dark:bg-neutral-900">
        {ad.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" className="mx-auto mb-2 h-32 w-full rounded-lg object-cover" />
        )}
        <p className="text-sm font-semibold">{ad.title ?? ad.advertiserName}</p>
        <p className="mt-1 text-xs text-neutral-400">Rewarded ad — {secondsLeft}s remaining</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={start}
        disabled={phase === "loading" || phase === "claiming"}
        className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {phase === "loading" ? "Loading ad…" : phase === "claiming" ? "Claiming…" : "🎬 Watch an ad, earn Credits"}
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
