/**
 * lib/presence/usePresenceHeartbeat.ts
 *
 * React hook that keeps the authenticated user's presence warm app-wide.
 *
 * Root cause fix: POST /api/presence (which sets `users.last_active_at` +
 * a 5-minute Redis TTL key, see app/api/presence/route.ts) was never called
 * by any client — only GET /api/presence (activity count) and GET
 * /api/presence/[userId] (read another user's status) were wired up. As a
 * result `last_active_at` only ever updated once, at login
 * (app/api/login/daily/route.ts), so users appeared "recently active" for
 * at most an hour after signing in and then looked permanently offline —
 * breaking both the admin "Last Active" column and the Home page's
 * "Online Friends" row (GET /api/friends/online filters on last_active_at).
 *
 * Usage: mount PresenceHeartbeatProvider once in the authenticated app
 * layout — fires on mount, then every HEARTBEAT_INTERVAL_MS while the tab
 * is visible. Only one Redis SET + one UPDATE per interval per active user,
 * matching the 5-minute TTL the endpoint already uses (no new Redis calls).
 */

"use client";

import { useEffect, useRef } from "react";

/** Comfortably inside the 5-minute online TTL (see app/api/presence/route.ts). */
const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

function sendHeartbeat() {
  fetch("/api/presence", {
    method: "POST",
    credentials: "include",
    keepalive: true,
  }).catch(() => {});
}

export function usePresenceHeartbeat() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function beatIfVisible() {
      if (document.visibilityState === "visible") sendHeartbeat();
    }

    // Fire immediately on mount (covers app open / navigation into the app shell).
    beatIfVisible();

    intervalRef.current = setInterval(beatIfVisible, HEARTBEAT_INTERVAL_MS);

    // Also beat on tab refocus so returning to the app doesn't wait for the interval.
    document.addEventListener("visibilitychange", beatIfVisible);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", beatIfVisible);
    };
  }, []);
}
