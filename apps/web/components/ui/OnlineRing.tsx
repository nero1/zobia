"use client";

/**
 * components/ui/OnlineRing.tsx
 *
 * Wraps an avatar with a colored online-status ring.
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
}

// ---------------------------------------------------------------------------
// Ring size config
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * OnlineRing — wraps children (avatar) with a presence indicator ring.
 * Defaults to 'offline' while loading; quietly fetches presence.
 */
export function OnlineRing({ userId, size = "md", children }: OnlineRingProps) {
  const [status, setStatus] = useState<PresenceStatus>("offline");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/presence/${userId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: PresenceStatus } | null) => {
        if (!cancelled && d?.status) setStatus(d.status);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`rounded-full ${RING_SIZE[size]} ${STATUS_RING[status]}`}
        role="img"
        aria-label={`Status: ${status.replace("_", " ")}`}
      >
        {children}
      </div>
      {/* Dot indicator */}
      <span
        className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-white dark:ring-neutral-900 ${DOT_SIZE[size]} ${STATUS_DOT[status]}`}
      />
    </div>
  );
}
