"use client";

/**
 * lib/auth/sessionExpiryBus.ts
 *
 * Tracks when the CURRENT access token will expire so the UI can warn the
 * user shortly beforehand (see components/auth/SessionExpiryCountdown.tsx),
 * distinct from lib/auth/sessionExpiredBus.ts which announces that the
 * session has ALREADY died.
 *
 * The expiry timestamp is set from two sources:
 *   - `useAuth()` primes it once on mount from GET /api/auth/me's
 *     `expiresAt` field (covers cold page loads / new tabs — the access
 *     token itself is an HttpOnly cookie the client can't read directly).
 *   - `authFetch`/`apiClient`'s own silent-refresh logic calls
 *     `setSessionExpiresAt()` again after every successful refresh, so the
 *     countdown always reflects the token actually in the cookie jar.
 *
 * No polling and no extra network calls of its own — purely a client-side
 * clock driven off timestamps the app already fetches.
 */

const EVENT = "zobia:session-expiry-changed";

let expiresAt: number | null = null;

/** Epoch-ms the current access token expires at, or null if unknown. */
export function getSessionExpiresAt(): number | null {
  return expiresAt;
}

/** Record a new access-token expiry and notify listeners. */
export function setSessionExpiresAt(nextExpiresAt: number | null): void {
  expiresAt = nextExpiresAt;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
}

/**
 * Subscribe to expiry changes. Returns an unsubscribe function. Fires
 * immediately with the current value so a component mounting after the
 * first update still picks it up.
 */
export function onSessionExpiryChange(cb: (nextExpiresAt: number | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(expiresAt);
  window.addEventListener(EVENT, handler);
  cb(expiresAt);
  return () => window.removeEventListener(EVENT, handler);
}
