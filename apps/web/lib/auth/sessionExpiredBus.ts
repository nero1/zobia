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

/**
 * Global 401 guard.
 *
 * Most authenticated pages call `apiClient` (axios) or `authFetch`, both of
 * which already attempt a silent refresh and fall back to
 * `markSessionExpired()`. But a large number of pages call the native
 * `fetch()` directly against `/api/*` routes with no 401 handling at all —
 * those requests just fail silently forever once the session is gone, so
 * the user's clicks appear to do nothing and the "signed out" notice never
 * shows.
 *
 * Rather than touching every call site, we patch `window.fetch` once at
 * startup: any same-origin `/api/*` response with status 401 (outside the
 * auth endpoints below, which legitimately 401 as part of login/refresh
 * flows) marks the session expired. `authFetch`/`apiClient` keep using
 * {@link rawFetch} (the pre-patch `fetch`) for their own request, so their
 * silent-refresh-then-retry logic still runs first and this guard never
 * short-circuits it — it only catches the requests nothing else is
 * watching.
 */
const EXEMPT_API_PATH_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/silent-refresh",
  "/api/auth/logout",
  "/api/auth/2fa",
  "/api/auth/mobile-bridge",
  "/api/auth/google",
  "/api/auth/telegram",
];

function isExemptApiPath(pathname: string): boolean {
  return EXEMPT_API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

let originalFetch: typeof fetch | null = null;
let guardInstalled = false;

/** Pre-patch `fetch`, for callers (authFetch, the refresh POST) that must not be re-intercepted. */
export function rawFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return (originalFetch ?? fetch)(input, init);
}

export function installSessionExpiryFetchGuard(): void {
  if (guardInstalled || typeof window === "undefined") return;
  guardInstalled = true;
  originalFetch = window.fetch.bind(window);
  const base = originalFetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await base(input, init);
    if (res.status === 401) {
      try {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const parsed = new URL(rawUrl, window.location.origin);
        if (
          parsed.origin === window.location.origin &&
          parsed.pathname.startsWith("/api/") &&
          !isExemptApiPath(parsed.pathname)
        ) {
          markSessionExpired();
        }
      } catch {
        // Malformed/opaque URL — don't let guard logic break the response.
      }
    }
    return res;
  };
}
