"use client";

/**
 * components/ui/XPActivityBanner.tsx
 *
 * Ambient social-proof banner showing "X people earned XP in the last hour".
 * PRD §2.2 — The Presence Layer: "'X people earned XP in the last hour' banners
 * on the home screen give ambient awareness."
 *
 * Distinct from ActivityBanner (which shows platform XP multiplier events).
 * Polls GET /api/presence every 60 seconds. Hides when count is 0.
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresenceData {
  activeCount: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * XPActivityBanner — shows ambient "X people earned XP in the last hour" signal.
 * Refreshes every 60s. Hidden when 0 active users.
 */
export function XPActivityBanner() {
  const [activeCount, setActiveCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetch_ = async () => {
      try {
        const res = await fetch("/api/presence", { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { data?: PresenceData };
        if (!cancelled && typeof data.data?.activeCount === "number") {
          setActiveCount(data.data.activeCount);
        }
      } catch { /* non-fatal */ }
    };

    void fetch_();
    const id = setInterval(() => void fetch_(), 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (activeCount === null || activeCount === 0) return null;

  const label =
    activeCount === 1
      ? "1 person earned XP in the last hour"
      : `${activeCount.toLocaleString()} people earned XP in the last hour`;

  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 dark:border-teal-800 dark:bg-teal-950/30"
      role="status"
      aria-live="polite"
    >
      <span className="text-base" aria-hidden>⚡</span>
      <p className="text-sm font-medium text-teal-700 dark:text-teal-300">{label}</p>
    </div>
  );
}
