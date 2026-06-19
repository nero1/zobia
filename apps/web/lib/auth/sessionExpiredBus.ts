"use client";

/**
 * lib/auth/sessionExpiredBus.ts
 *
 * Tiny client-side bus that signals "the session expired and could not be
 * silently refreshed". Any code path that observes an unrecoverable 401 (the
 * axios interceptor, the chat `authFetch` wrapper, a raw fetch in a long-lived
 * page) calls `markSessionExpired()`. A single app-level provider listens via
 * `onSessionExpired()` and shows the "you've been signed out" notice.
 *
 * Why a bus instead of throwing/redirecting at the call site:
 *   - A room (or any page) can stay open for a long time. When the session
 *     expires the page does NOT navigate, so its background polls just start
 *     failing silently. We need a way for those silent failures — and the next
 *     user action — to surface a single, app-wide notice rather than a redirect
 *     loop or a swallowed error.
 *   - It is idempotent: many concurrent 401s collapse into one notice.
 */

/** Window event name used to broadcast session expiry across components. */
const EVENT = "zobia:session-expired";

/** Latched flag so late subscribers (and user actions) can read current state. */
let expired = false;

/** True once an unrecoverable 401 has been observed in this tab. */
export function isSessionExpired(): boolean {
  return expired;
}

/**
 * Mark the session as expired and notify listeners. Safe to call repeatedly;
 * the notice is only raised once until {@link resetSessionExpired} is called.
 */
export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

/** Clear the latch (e.g. after the user signs back in / navigates to login). */
export function resetSessionExpired(): void {
  expired = false;
}

/**
 * Subscribe to session-expiry events. Returns an unsubscribe function.
 * Fires immediately if the session is already known to be expired so a
 * component mounting after the event still reacts.
 */
export function onSessionExpired(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  if (expired) cb();
  return () => window.removeEventListener(EVENT, handler);
}
