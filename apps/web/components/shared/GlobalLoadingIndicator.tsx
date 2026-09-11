"use client";

/**
 * components/shared/GlobalLoadingIndicator.tsx
 *
 * Mounted once in app/layout.tsx. Shows a small spinning-circle overlay
 * (fixed, top-center, above any page content including a pulsing skeleton)
 * whenever there's an in-flight fetch anywhere in the app — see
 * lib/loading/requestActivity.ts for why fetch-instrumentation was chosen
 * over per-page loading state.
 *
 * Debounced so a near-instant response never flickers the spinner, and held
 * for a minimum visible duration once shown so it doesn't blink on/off
 * during a fast burst of requests (e.g. a page firing 3 parallel fetches).
 */

import { useEffect, useState, useRef } from "react";
import { installFetchActivityTracking, subscribeToRequestActivity } from "@/lib/loading/requestActivity";

/** Only show the spinner if a request is still in flight after this long — avoids flicker on fast responses. */
const SHOW_DELAY_MS = 200;
/** Once shown, keep it visible at least this long — avoids blinking during bursts of quick requests. */
const MIN_VISIBLE_MS = 400;

export function GlobalLoadingIndicator() {
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    installFetchActivityTracking();

    const unsubscribe = subscribeToRequestActivity((count) => {
      if (count > 0) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        if (!showTimerRef.current && shownAtRef.current === null) {
          showTimerRef.current = setTimeout(() => {
            shownAtRef.current = Date.now();
            setVisible(true);
            showTimerRef.current = null;
          }, SHOW_DELAY_MS);
        }
      } else {
        if (showTimerRef.current) {
          clearTimeout(showTimerRef.current);
          showTimerRef.current = null;
        }
        if (shownAtRef.current !== null) {
          const elapsed = Date.now() - shownAtRef.current;
          const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
          hideTimerRef.current = setTimeout(() => {
            setVisible(false);
            shownAtRef.current = null;
            hideTimerRef.current = null;
          }, remaining);
        }
      }
    });

    return () => {
      unsubscribe();
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex justify-center"
    >
      <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  );
}
