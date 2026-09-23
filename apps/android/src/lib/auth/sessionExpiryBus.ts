/**
 * apps/android/src/lib/auth/sessionExpiryBus.ts
 *
 * Mirrors apps/web/lib/auth/sessionExpiryBus.ts, adapted for the Bearer-token
 * auth this app uses: since there's no HttpOnly cookie hiding the access
 * token from JS, the expiry is read straight off the JWT's own `exp` claim
 * (decodeJwtExpiryMs) instead of needing a server round-trip to learn it.
 *
 * Updated from lib/auth/store.ts (on boot + setAuth + clearAuth) and
 * lib/api/client.ts (after every silent token refresh), so it always
 * reflects whatever token is actually cached/stored.
 */

const EVENT = 'zobia:session-expiry-changed';

let expiresAt: number | null = null;

/** Decode a JWT's `exp` claim (seconds since epoch) to epoch-ms, or null if unreadable. */
export function decodeJwtExpiryMs(token: string): number | null {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function getSessionExpiresAt(): number | null {
  return expiresAt;
}

/** Set the tracked expiry directly (epoch-ms), or clear it with null. */
export function setSessionExpiresAt(nextExpiresAt: number | null): void {
  expiresAt = nextExpiresAt;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Convenience: derive and set the expiry from a raw access token (or clear it if null). */
export function setSessionExpiresAtFromToken(token: string | null): void {
  setSessionExpiresAt(token ? decodeJwtExpiryMs(token) : null);
}

export function onSessionExpiryChange(cb: (nextExpiresAt: number | null) => void): () => void {
  const handler = () => cb(expiresAt);
  window.addEventListener(EVENT, handler);
  cb(expiresAt);
  return () => window.removeEventListener(EVENT, handler);
}
