"use client";

/**
 * components/ui/OnlineRing.tsx
 *
 * Wraps an avatar with a presence indicator ring.
 * - "online"          → steady bright teal ring + pulsing dot (active now, PRD §2.2)
 * - "recently_active" → amber ring + soft pulsing dot
 * - "offline"         → neutral ring, no animation
 *
 * Fetches presence from GET /api/presence/[userId] on mount.
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PresenceStatus = "online" | "recently_active" | "offline";

interface OnlineRingProps {
  userId: string;
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  /**
   * Pre-known presence status. When provided, skips the GET /api/presence/[userId]
   * fetch entirely — use this whenever the caller already has presence data from
   * a list endpoint (e.g. GET /api/friends/online), to avoid firing one Redis-backed
   * request per rendered avatar.
   */
  knownStatus?: PresenceStatus;
}

// ---------------------------------------------------------------------------
// Size config
// ---------------------------------------------------------------------------

const RING_SIZE: Record<string, string> = {
  sm: "ring-2",
  md: "ring-2",
  lg: "ring-[3px]",
};

const DOT_SIZE: Record<string, string> = {
  sm: "h-2 w-2 ring-1",
  md: "h-2.5 w-2.5 ring-1",
  lg: "h-3 w-3 ring-[2px]",
};

const STATUS_RING: Record<PresenceStatus, string> = {
  online: "ring-teal-500",
  recently_active: "ring-amber-400",
  offline: "ring-neutral-300 dark:ring-neutral-600",
};

const STATUS_DOT: Record<PresenceStatus, string> = {
  online: "bg-teal-500",
  recently_active: "bg-amber-400",
  offline: "bg-neutral-300 dark:bg-neutral-600",
};

// Pulse animation: "online" uses fast ping, "recently_active" uses slow ping
const DOT_ANIMATION: Record<PresenceStatus, string> = {
  online: "animate-ping-fast",
  recently_active: "animate-ping-slow",
  offline: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * OnlineRing — wraps children (avatar) with a presence indicator ring.
 * Online status pings steadily; recently active pulses softly; offline is static.
 */
export function OnlineRing({ userId, size = "md", children, knownStatus }: OnlineRingProps) {
  const [status, setStatus] = useState<PresenceStatus>(knownStatus ?? "offline");

  useEffect(() => {
    if (knownStatus) { setStatus(knownStatus); return; }
    if (!userId || userId === "undefined") return;
    let cancelled = false;
    fetch(`/api/presence/${userId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: PresenceStatus; data?: { status?: PresenceStatus } } | null) => {
        const resolved = d?.data?.status ?? d?.status;
        if (!cancelled && resolved) setStatus(resolved);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, knownStatus]);

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`rounded-full ${RING_SIZE[size]} ${STATUS_RING[status]}`}
        role="img"
        aria-label={`Status: ${status.replace("_", " ")}`}
      >
        {children}
      </div>

      {/* Animated dot indicator */}
      <span className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-white dark:ring-neutral-900 ${DOT_SIZE[size]} ${STATUS_DOT[status]}`}>
        {/* Ping animation layer for online/recently_active */}
        {status !== "offline" && (
          <span
            className={`absolute inset-0 rounded-full opacity-75 ${STATUS_DOT[status]} ${DOT_ANIMATION[status]}`}
          />
        )}
      </span>
    </div>
  );
}
