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
 * is visible, throttled across tabs via shared storage. Presence costs zero
 * Redis commands now: it is derived from `users.last_active_at`, which this
 * heartbeat is the sole writer of (REDIS-COST-01, see lib/presence/keys.ts).
 */

"use client";

import { useEffect, useRef } from "react";

/** Comfortably inside the 5-minute online window (see lib/presence/keys.ts). */
const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Shared-storage key holding the timestamp of the last heartbeat sent by ANY
 * tab in this browser profile.
 *
 * REDIS-COST-01 / write reduction: the hook beats on mount, on an interval and
 * on every `visibilitychange`. With several tabs open — or a user flicking
 * between tabs — that produced a burst of `POST /api/presence` calls seconds
 * apart, each one a full authenticated request. Because `localStorage` is
 * shared across tabs of the same origin, one timestamp there de-duplicates all
 * of them.
 *
 * Deliberately NOT user-scoped, and deliberately holding no user data: it is a
 * bare millisecond timestamp, so there is nothing to leak between accounts on
 * a shared device. Scoping it per user would actually defeat the purpose,
 * since the point is to throttle the browser as a whole. The server applies
 * its own per-user throttle regardless (app/api/presence/route.ts).
 */
const LAST_BEAT_STORAGE_KEY = "zobia_presence_last_beat";

/** Read the last beat timestamp, tolerating disabled/blocked storage. */
function readLastBeat(): number {
  try {
    const raw = window.localStorage.getItem(LAST_BEAT_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // Private mode / storage disabled — fall back to always beating, which is
    // the old behaviour and still correct, just chattier.
    return 0;
  }
}

/** Record that a beat was just sent. Best-effort. */
function writeLastBeat(at: number): void {
  try {
    window.localStorage.setItem(LAST_BEAT_STORAGE_KEY, String(at));
  } catch {
    /* quota / unavailable — ignore */
  }
}

function sendHeartbeat() {
  const now = Date.now();
  // Leave a little slack (90%) so the interval-driven beat is never skipped
  // just because it fired a few milliseconds early.
  if (now - readLastBeat() < HEARTBEAT_INTERVAL_MS * 0.9) return;
  writeLastBeat(now);

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

    // Also beat on tab refocus so returning to the app doesn't wait for the
    // interval. The shared-storage throttle above keeps this from turning rapid
    // tab switching into a request storm.
    document.addEventListener("visibilitychange", beatIfVisible);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", beatIfVisible);
    };
  }, []);
}
