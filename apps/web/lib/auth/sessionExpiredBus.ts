"use client";
import { cachedRead, invalidateReadCache, readCacheKey, writeInvalidatesReadCache } from "@/lib/cache/readCache";

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

/**
 * Device-level hint that this browser had a signed-in session. It is a plain
 * boolean (no user data, so nothing can leak between accounts on a shared
 * device). It exists so that a 401 seen by a visitor who was never signed in
 * (e.g. the landing page priming GET /api/auth/me) is NOT reported as an
 * expired session, and so a genuine expiry is announced exactly once instead
 * of on every future visit.
 */
const HAD_SESSION_KEY = "zobia:auth:had-session";

function readHadSession(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(HAD_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Per-tab copy of the hint (survives another tab clearing the shared key). */
let hadSession = readHadSession();

/** True when this tab/device believes the user has (had) a signed-in session. */
export function hasSessionHint(): boolean {
  return hadSession;
}

/** Record that the user is signed in (call after an authenticated response). */
export function markSessionActive(): void {
  hadSession = true;
  try {
    window.localStorage.setItem(HAD_SESSION_KEY, "1");
  } catch {
    // Storage unavailable — the per-tab flag still works.
  }
}

/** Forget the signed-in hint (explicit logout, or once expiry was announced). */
export function clearSessionHint(): void {
  hadSession = false;
  try {
    window.localStorage.removeItem(HAD_SESSION_KEY);
  } catch {
    // ignore
  }
  // The signed-out user's cached reads and shared realtime connection must
  // not survive into the next session on this tab (logout is a client-side
  // navigation, not a reload). Imported lazily: the realtime module pulls in
  // the Ably SDK only when it was actually used.
  invalidateReadCache();
  if (typeof window !== "undefined") {
    void import("@/lib/realtime/ablyShared").then(({ closeAbly }) => closeAbly()).catch(() => {});
  }
}

/** Latched flag so late subscribers (and user actions) can read current state. */
let expired = false;

/** True once an unrecoverable 401 has been observed in this tab. */
export function isSessionExpired(): boolean {
  return expired;
}

/**
 * Mark the session as expired and notify listeners. Safe to call repeatedly;
 * the notice is only raised once until {@link resetSessionExpired} is called.
 *
 * BUG: "logged in as an empty user without seeing the Google screen" — once a
 * session is confirmed dead (this function runs), the browser can still be
 * holding a `zobia_at` access-token cookie that is cryptographically valid
 * (not yet past its own `exp`) even though the underlying session was
 * revoked server-side (see lib/auth/session.ts SessionRevokedError). Only
 * /api/auth/refresh and /api/auth/silent-refresh clear that cookie on a
 * *genuine* revocation — a plain API 401 (which is what actually lands here,
 * via the SessionExpiredModal "Sign in" button or the window.fetch guard
 * below) never did.
 *
 * middleware.ts's public-route handling only checks JWT signature/expiry
 * (not revocation) before bouncing a signed-in-looking visitor away from
 * /auth/login straight back to /home — so with that stale-but-unexpired
 * cookie still present, clicking "Sign in" never reaches the actual Google
 * OAuth button: the user is redirected right back into an app shell whose
 * client-side user fetch 401s, rendering the "Your Name"/"@username"/"U"
 * placeholders.
 *
 * Clearing the cookies here (the same POST /api/auth/logout every explicit
 * "Log out" action already uses — always 200, always clears both cookies)
 * closes that gap: by the time the user acts on the notice, the cookie jar
 * is already empty, so the next /auth/login visit renders the real sign-in
 * screen instead of bouncing back.
 */
export function markSessionExpired(): void {
  if (expired) return;
  // A 401 for someone who never had a session (anonymous visitor, or a
  // visitor whose expiry was already announced) is just "not signed in",
  // not "your session expired".
  if (!hadSession) return;
  expired = true;
  // Announce once: clear the shared device hint so a new window/visit does
  // not show the notice again. Other already-open tabs keep their own
  // per-tab flag and still show it.
  try {
    window.localStorage.removeItem(HAD_SESSION_KEY);
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT));
  }
  // Session is confirmed dead — stop the expiry countdown (imported lazily to
  // avoid a module cycle; sessionExpiryBus never imports this file back).
  void import("./sessionExpiryBus").then(({ setSessionExpiresAt }) => setSessionExpiresAt(null));
  void clearAuthCookies();
}

/**
 * Clear the browser's zobia_at/zobia_rt cookies via the existing logout
 * endpoint (always 200, always clears both cookies — see
 * app/api/auth/logout/route.ts). Uses {@link rawFetch} so this never
 * re-triggers the 401 guard below, and is safe to call multiple times.
 */
export function clearAuthCookies(): Promise<void> {
  clearSessionHint();
  invalidateReadCache();
  return rawFetch("/api/auth/logout", { method: "POST", credentials: "include" })
    .then(() => undefined)
    .catch(() => undefined);
}

/** Clear the latch (e.g. after the user signs back in / navigates to login). */
export function resetSessionExpired(): void {
  expired = false;
  hadSession = false;
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
  // Identity probe: a 401 here just means "no session". useAuth() handles it
  // explicitly (silent refresh, then markSessionExpired) — see lib/auth/hooks.ts.
  "/api/auth/me",
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

function isLogoutRequest(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return new URL(raw, window.location.origin).pathname === "/api/auth/logout";
  } catch {
    return false;
  }
}

export function installSessionExpiryFetchGuard(): void {
  if (guardInstalled || typeof window === "undefined") return;
  guardInstalled = true;
  originalFetch = window.fetch.bind(window);
  const base = originalFetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let parsed: URL | null = null;
    try {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      parsed = new URL(rawUrl, window.location.origin);
    } catch {
      // Malformed/opaque URL — don't let guard logic break the request.
    }
    const sameOriginApi =
      parsed !== null && parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    // Hot reads (identity, home widgets, badge, ads) are shared and cached
    // briefly; any write may change what they return, so it drops the cache
    // both before it is sent and after it completes. See lib/cache/readCache.ts.
    const cacheKey = sameOriginApi && parsed ? readCacheKey(parsed, method) : null;
    const isWrite =
      sameOriginApi &&
      parsed !== null &&
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS" &&
      writeInvalidatesReadCache(parsed.pathname);
    if (isWrite) invalidateReadCache();

    const res = cacheKey
      ? await cachedRead(cacheKey, () => base(input, init))
      : await base(input, init);

    if (isWrite) invalidateReadCache();
    if (isLogoutRequest(input)) clearSessionHint();
    if (res.status === 401) {
      invalidateReadCache();
      if (sameOriginApi && parsed && !isExemptApiPath(parsed.pathname)) {
        markSessionExpired();
      }
    }
    return res;
  };
}
