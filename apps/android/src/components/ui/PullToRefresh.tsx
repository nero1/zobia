/**
 * apps/android/src/components/ui/PullToRefresh.tsx
 *
 * Dependency-free pull-to-refresh wrapper (ZB-AND-12 fix) — neither the web/PWA
 * nor the Android app implemented this despite it being one of the most
 * expected native-feeling mobile affordances for feed-style screens (Rooms,
 * Moments, Notifications, Messages).
 *
 * Wraps a scrollable container: tracks a touch-start/touch-move delta only
 * when the container is already scrolled to the top (so it never fights
 * normal mid-list scrolling), reveals a small spinner past a threshold, and
 * calls `onRefresh` on release past that threshold.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

const PULL_THRESHOLD = 64;
const MAX_PULL = 96;
const RESISTANCE = 0.5;

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | unknown;
  className?: string;
  children: ReactNode;
}

export function PullToRefresh({ onRefresh, className, children }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      startYRef.current = el.scrollTop <= 0 ? e.touches[0].clientY : null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      // ZSB-25 fix: `startYRef` used to only ever get latched in
      // `onTouchStart`, based on scrollTop at the *instant the touch began*.
      // A gesture that starts mid-list (scrollTop > 0) and scrolls up to the
      // top within the same continuous touch never armed the refresh
      // indicator, even though the user was now at the top and pulling down.
      // Re-check here and latch the first time scrollTop reaches 0 mid-drag.
      if (startYRef.current === null) {
        if (el.scrollTop <= 0) startYRef.current = e.touches[0].clientY;
        return;
      }
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0 || el.scrollTop > 0) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      const distance = Math.min(delta * RESISTANCE, MAX_PULL);
      pullDistanceRef.current = distance;
      setPullDistance(distance);
    };

    const onTouchEnd = () => {
      startYRef.current = null;
      if (pullDistanceRef.current >= PULL_THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        Promise.resolve(onRefreshRef.current()).finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        });
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const indicatorHeight = refreshing ? PULL_THRESHOLD : pullDistance;

  return (
    <div ref={containerRef} className={className}>
      <div
        aria-hidden="true"
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: indicatorHeight }}
      >
        {(refreshing || pullDistance > 8) && (
          <div
            className={`w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full ${refreshing || pullDistance >= PULL_THRESHOLD ? 'animate-spin' : ''}`}
            style={!refreshing ? { transform: `rotate(${pullDistance * 3}deg)` } : undefined}
          />
        )}
      </div>
      {children}
    </div>
  );
}
