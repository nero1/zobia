/**
 * apps/android/src/components/shared/GlobalLoadingIndicator.tsx
 *
 * Mirrors apps/web/components/shared/GlobalLoadingIndicator.tsx — mounted
 * once in routes/__root.tsx. Shows a small spinning-circle overlay whenever
 * there's an in-flight API request, so a tap gives instant feedback instead
 * of leaving the user unsure whether it registered on a slow connection.
 */

import { useEffect, useRef, useState } from 'react';
import { subscribeToRequestActivity } from '@/lib/loading/requestActivity';

const SHOW_DELAY_MS = 200;
const MIN_VISIBLE_MS = 400;

export function GlobalLoadingIndicator() {
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
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
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center"
      style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
    >
      <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3 py-1.5 shadow-lg">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  );
}
