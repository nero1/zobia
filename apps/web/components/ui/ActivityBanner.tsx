"use client";

/**
 * components/ui/ActivityBanner.tsx
 *
 * Dismissible banner showing platform-wide activity/events.
 * If event has xp_multiplier > 1, shows a "🔥 Nx XP Active: <name>" banner.
 * Dismissed state is persisted in sessionStorage so it doesn't re-appear
 * during the session.
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformEvent {
  name: string;
  description: string;
  xp_multiplier: number;
}

interface ActivityBannerProps {
  event: PlatformEvent | null;
}

const STORAGE_KEY = "zobia:dismissed_activity_banner";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ActivityBanner — shows a 2x/3x XP event banner that can be dismissed.
 * Dismissed state is stored in sessionStorage (resets on tab close).
 */
export function ActivityBanner({ event }: ActivityBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored && event && stored === event.name) {
        setDismissed(true);
      }
    }
  }, [event]);

  function handleDismiss() {
    setDismissed(true);
    if (typeof window !== "undefined" && event) {
      sessionStorage.setItem(STORAGE_KEY, event.name);
    }
  }

  if (!event || event.xp_multiplier <= 1 || dismissed) {
    return null;
  }

  return (
    <div
      className="relative flex items-center gap-3 bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 shadow-sm dark:from-orange-700 dark:to-amber-700"
      role="banner"
      aria-live="polite"
    >
      <span className="text-lg" aria-hidden>🔥</span>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-bold text-white">
          {event.xp_multiplier}x XP Active:{" "}
        </span>
        <span className="text-sm font-semibold text-orange-100">{event.name}</span>
        {event.description && (
          <span className="ml-2 hidden text-xs text-orange-200 sm:inline">— {event.description}</span>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-orange-100 hover:bg-white/20"
        aria-label="Dismiss banner"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
