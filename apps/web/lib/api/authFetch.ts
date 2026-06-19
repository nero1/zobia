"use client";

/**
 * lib/api/authFetch.ts
 *
 * `fetch` wrapper for authenticated, same-origin calls made from long-lived
 * client pages (chat rooms, DMs, groups) that use the native `fetch` API
 * directly rather than the axios `apiClient`.
 *
 * It mirrors the axios interceptor (lib/api/client.ts):
 *   1. On a 401, attempt a single silent cookie-based token refresh.
 *   2. If the refresh succeeds, retry the original request exactly once.
 *   3. If the refresh fails (session truly gone), broadcast session expiry via
 *      the session bus so the app shows the "you've been signed out" notice,
 *      then return the original 401 response to the caller.
 *
 * The refresh is single-flighted at module scope, shared with concurrent
 * callers, so a burst of 401s (e.g. a poll + a send at the same instant)
 * triggers only one /api/auth/refresh round-trip.
 */

import { markSessionExpired } from "@/lib/auth/sessionExpiredBus";

let refreshPromise: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * Authenticated same-origin fetch with silent-refresh + session-expiry handling.
 * Always sends credentials. On unrecoverable 401 it marks the session expired
 * (raising the app-wide notice) and returns the 401 response unchanged.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const withCreds: RequestInit = { credentials: "include", ...init };

  let res = await fetch(input, withCreds);
  if (res.status !== 401) return res;

  const refreshed = await refreshOnce();
  if (refreshed) {
    res = await fetch(input, withCreds);
    if (res.status !== 401) return res;
  }

  // Still unauthorised after a refresh attempt — the session is gone.
  markSessionExpired();
  return res;
}
