/**
 * apps/android/src/components/ui/PullToRefresh.tsx
 *
 * Ported from apps/web/components/ui/PullToRefresh.tsx (also used inside
 * that Next.js app's Capacitor WebView mirror per its own doc comment) —
 * no existing pull-to-refresh pattern was found elsewhere in this app (see
 * home.tsx's rebuild), so this is the same dependency-free touch-based
 * approach, unchanged behavior. Tracks touchstart/touchmove Y-delta only
 * when the page is already scrolled to the top (window.scrollY === 0),
 * shows a simple arrow/spinner indicator past a threshold, and calls
 * `onRefresh` on release past that threshold.
 *
 * No-op (renders children plain) on non-touch input — desktop mouse drags
 * are not supported, matching how pull-to-refresh works natively.
 */

import { useCallback, useRef, useState, type ReactNode, type TouchEvent } from 'react';

const PULL_THRESHOLD_PX = 64;
const MAX_PULL_PX = 110;

export function PullToRefresh({
  onRefresh,
  children,
  className,
}: {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const trackingRef = useRef(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (window.scrollY > 0 || refreshing) {
        trackingRef.current = false;
        return;
      }
      startYRef.current = e.touches[0]?.clientY ?? null;
      trackingRef.current = true;
    },
    [refreshing]
  );

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!trackingRef.current || startYRef.current == null) return;
    const currentY = e.touches[0]?.clientY ?? startYRef.current;
    const delta = currentY - startYRef.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    // Only take over the gesture once we're confident it's a pull-down at
    // the top of the page — otherwise let normal scrolling happen.
    if (window.scrollY > 0) {
      trackingRef.current = false;
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(delta * 0.5, MAX_PULL_PX));
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!trackingRef.current) return;
    trackingRef.current = false;
    startYRef.current = null;
    if (pullDistance >= PULL_THRESHOLD_PX && !refreshing) {
      setRefreshing(true);
      setPullDistance(PULL_THRESHOLD_PX);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, refreshing, onRefresh]);

  const indicatorVisible = pullDistance > 8 || refreshing;
  const progress = Math.min(pullDistance / PULL_THRESHOLD_PX, 1);

  return (
    <div className={className} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div
        aria-hidden="true"
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: indicatorVisible ? Math.max(pullDistance, refreshing ? 40 : 0) : 0 }}
      >
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-neutral-300 dark:border-neutral-600 text-neutral-500 dark:text-neutral-400 ${
            refreshing ? 'animate-spin border-t-primary-500' : ''
          }`}
          style={!refreshing ? { transform: `rotate(${progress * 180}deg)` } : undefined}
        >
          {!refreshing && (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
