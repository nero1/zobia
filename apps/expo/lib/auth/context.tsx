/**
 * Zobia Social — Auth context.
 *
 * Stores the JWT in `expo-secure-store` and exposes:
 *  - `user`      — decoded user payload (or null when logged out)
 *  - `token`     — raw JWT string (or null)
 *  - `isLoading` — true while restoring the token on app start
 *  - `signIn`    — persist a token and decode the user
 *  - `signOut`   — wipe the token and reset state
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { apiClient, JWT_KEY, REFRESH_TOKEN_KEY, onUnauthenticated, onUserUpdated, refreshAccessToken, setCachedToken, resetUnauthenticatedFlag } from '@/lib/api/client';
import { clearStore } from '@/lib/offline/store';
import { clearOfflineQueue } from '@/lib/offline/sqlite';
import { disconnectGooglePlayBilling } from '@/lib/payments/googlePlay';
import type { RankName } from '@zobia/types';

// ---------------------------------------------------------------------------
// JWT expiry helpers (no signature verification — just payload inspection)
// ---------------------------------------------------------------------------

function decodeBase64Url(base64url: string): string {
  // JWT uses base64url encoding which replaces + with - and / with _.
  // Standard atob() only handles base64 (not base64url), so we must convert first.
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to a multiple of 4 characters as required by base64.
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
  return atob(padded);
}

function getJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Returns true if the token is expired or will expire within the next 60 seconds. */
function isTokenExpiredOrExpiring(token: string): boolean {
  const exp = getJwtExp(token);
  if (exp === null) return true;
  return exp * 1000 < Date.now() + 60_000;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full user payload stored in SecureStore and exposed via auth context. */
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  city: string;
  xp: number;
  rankTier: RankName;
  /** Subscription plan tier. */
  plan: 'free' | 'plus' | 'pro' | 'max';
  isAdmin: boolean;
  isModerator: boolean;
  isCreator: boolean;
  onboardingCompleted: boolean;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  /** True when the user's session expired and they were logged out automatically. */
  sessionExpired: boolean;
  /** Call this after the user has seen the session-expired message. */
  clearSessionExpired: () => void;
  /**
   * Persist `jwt`, `refreshToken`, and `user`.
   * @param jwt          Raw access JWT string received from the Zobia API.
   * @param user         Decoded user object (avoid runtime crypto dependency).
   * @param refreshToken Raw refresh token (optional for backward compat).
   */
  signIn: (jwt: string, user: AuthUser, refreshToken?: string) => Promise<void>;
  /** Clear the stored token and reset auth state. */
  signOut: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  sessionExpired: false,
  clearSessionExpired: () => {},
  signIn: async () => {},
  signOut: async () => {},
});


// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * AuthProvider — wrap the root layout with this.
 *
 * On mount it attempts to restore a persisted JWT from SecureStore.
 * Because the JWT payload is stored alongside the token, no crypto
 * dependency is needed at startup.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Track whether the user has ever been shown authenticated content in THIS
  // app session. The "session expired" modal should only appear when the user
  // was actively using the app and then got signed out mid-session. During the
  // initial startup phase (restoring credentials from SecureStore), a 401 from
  // the first tab API call should silently redirect to the login screen rather
  // than showing the modal — which would confuse users on first install or after
  // a server-side session eviction with a still-valid JWT.
  const hasBeenAuthenticatedRef = useRef(false);

  // Restore persisted session on app start.
  // If the stored access token is expired or expiring within 60 s, attempt a
  // silent refresh before setting authenticated state.
  // BUG-EXPO-01/02: use silentRefresh() so network errors never log out offline users.
  useEffect(() => {
    // WHITE-SCREEN WATCHDOG: `isLoading` gates the first render in
    // app/_layout.tsx (`if (isLoading || !storeReady) return null`). If any
    // awaited call below were to hang (e.g. a SecureStore read that never
    // settles on a wedged keystore), isLoading would stay true forever and the
    // app would be trapped on a blank screen. This deadline guarantees the gate
    // always releases — worst case the user lands on the login screen.
    const watchdog = setTimeout(() => {
      setIsLoading(false);
    }, 12_000);
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync(JWT_KEY),
          SecureStore.getItemAsync('zobia_user'),
        ]);
        if (!storedToken || !storedUser) return;

        // BUG-006 FIX: validate the stored user JSON before using it.
        // Corrupt SecureStore data (disk error, migration mismatch) must not
        // crash the app on startup — log and fall through to the login screen.
        let parsedUser: AuthUser | null = null;
        try {
          const candidate = JSON.parse(storedUser) as Partial<AuthUser>;
          if (
            typeof candidate?.id === 'string' &&
            typeof candidate?.username === 'string'
          ) {
            parsedUser = candidate as AuthUser;
          }
        } catch {
          console.warn('[auth] Stored user JSON is corrupt — forcing re-login');
        }
        if (!parsedUser) return;

        if (isTokenExpiredOrExpiring(storedToken)) {
          const newAccessToken = await refreshAccessToken();
          if (newAccessToken) {
            setCachedToken(newAccessToken);
            setToken(newAccessToken);
            // H-5 FIX: refreshAccessToken() already calls notifyUserUpdated() with
            // a fresh user fetched from /users/me. Reading from SecureStore here
            // gives us the just-written fresh user rather than re-applying stale
            // parsedUser and overwriting what notifyUserUpdated already set.
            const freshUserJson = await SecureStore.getItemAsync('zobia_user').catch(() => null);
            const freshUser = freshUserJson ? (JSON.parse(freshUserJson) as AuthUser | null) : null;
            setUser(freshUser ?? parsedUser);
            hasBeenAuthenticatedRef.current = true;
          }
        } else {
          setCachedToken(storedToken);
          setToken(storedToken);
          setUser(parsedUser);
          // Mark as authenticated so the session-expired modal is shown if a
          // subsequent 401 (server-side session eviction) kicks the user out.
          hasBeenAuthenticatedRef.current = true;
        }
      } catch {
        // Storage read failures are non-fatal — user just needs to log in.
      } finally {
        clearTimeout(watchdog);
        setIsLoading(false);
      }
    })();
    return () => clearTimeout(watchdog);
  }, []);

  // Subscribe to unauthenticated events (triggered when token refresh fails).
  // Also clears SecureStore so stale credentials don't persist across app restarts.
  useEffect(() => {
    const unsubscribe = onUnauthenticated(() => {
      (async () => {
        try {
          await Promise.all([
            SecureStore.deleteItemAsync(JWT_KEY),
            SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
            SecureStore.deleteItemAsync('zobia_user'),
          ]);
        } catch {}
        // BUG-SEC-01 FIX: mirror the signOut cleanup so cross-account data leakage
        // and stale billing sessions are prevented on forced logout.
        try { clearStore(); } catch {}
        clearOfflineQueue().catch(() => {});
        if (Platform.OS === 'android') {
          disconnectGooglePlayBilling().catch(() => {});
        }
        // Only surface the "session expired" modal if the user was actively
        // authenticated and seen the app in this session. During startup
        // (credentials restored from SecureStore but first API call returns 401
        // because the server-side session was evicted), hasBeenAuthenticatedRef
        // may be true (we set it when restoring), so the modal shows as expected.
        // For a completely fresh install with no stored tokens, this path isn't
        // reached (refreshAccessToken returns null without calling notifyUnauthenticated).
        setSessionExpired(hasBeenAuthenticatedRef.current);
        hasBeenAuthenticatedRef.current = false;
        setToken(null);
        setUser(null);
      })();
    });
    return unsubscribe;
  }, []);

  // Subscribe to user-updated events (triggered after a successful silent token rotation)
  // so the in-memory user state reflects the latest XP, rank, and plan without re-login.
  useEffect(() => {
    const unsubscribe = onUserUpdated((userJson) => {
      try {
        const parsed = JSON.parse(userJson);
        // Validate the minimum required shape before replacing state so a
        // malformed payload from a stale/mismatched API version can't wipe the user.
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof parsed.id === 'string' &&
          typeof parsed.username === 'string'
        ) {
          setUser(parsed as AuthUser);
        }
      } catch {}
    });
    return unsubscribe;
  }, []);

  // Keep a stable ref to the current token so the AppState listener never
  // needs to be re-subscribed on every token rotation (BUG-LOW-29).
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // AppState foreground refresh: when the app becomes active and the stored
  // token is expired or expiring within 60 s, attempt a silent refresh so the
  // user doesn't get an auth error immediately after switching back to the app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (status) => {
      if (status !== 'active' || !tokenRef.current) return;
      if (!isTokenExpiredOrExpiring(tokenRef.current)) return;

      const newAccessToken = await refreshAccessToken();
      if (newAccessToken) {
        setToken(newAccessToken);
      }
    });
    return () => sub.remove();
  }, []);

  const signIn = useCallback(async (jwt: string, authUser: AuthUser, refreshToken?: string) => {
    // BUG-L03: Validate JWT structure before persisting. A malformed response
    // (proxy error, network glitch, future API version mismatch) could persist
    // garbage to SecureStore, causing a cryptic crash on the next app launch.
    // This is structural validation only — signature verification is server-side.
    const JWT_SEGMENT_RE = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/;
    if (!jwt || !JWT_SEGMENT_RE.test(jwt)) {
      throw new Error('signIn received a malformed access token — refusing to persist invalid credentials');
    }
    // Refresh tokens may be opaque strings (not JWTs) — skip structural
    // validation and let the server reject invalid values on next refresh.

    const writes: Promise<void>[] = [
      SecureStore.setItemAsync(JWT_KEY, jwt),
      SecureStore.setItemAsync('zobia_user', JSON.stringify(authUser)),
    ];
    if (refreshToken) {
      writes.push(SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken));
    }
    await Promise.all(writes);
    setCachedToken(jwt);
    // Reset the interceptor's notification guard so a future session expiry
    // will trigger the modal again (Bug 11 fix).
    resetUnauthenticatedFlag();
    hasBeenAuthenticatedRef.current = true;
    setSessionExpired(false);
    setToken(jwt);
    setUser(authUser);
  }, []);

  const signOut = useCallback(async () => {
    // BUG-007 FIX: remove illegal `Origin` header — mobiles/WebViews ignore
    // or reject it; the axios apiClient handles auth without it.
    // Best-effort server logout — invalidates Redis session and refresh token.
    // Fires and forgets: network failure or server error must never block local signout.
    if (token) {
      apiClient.post('/auth/logout').catch(() => {});
    }
    await Promise.all([
      SecureStore.deleteItemAsync(JWT_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync('zobia_user'),
    ]);
    setCachedToken(null);
    // BUG-010 FIX: clear MMKV store on sign-out to prevent cross-account data
    // leakage (cached feed, draft messages, preferences) on shared devices.
    try { clearStore(); } catch { /* store may not be initialised yet */ }
    // Clear SQLite offline queue so pending messages from this account are not
    // re-sent under a different account's JWT after re-login (BUG-038 fix).
    clearOfflineQueue().catch(() => {});
    // BUG-014 FIX: disconnect Google Play Billing so IAP session resolver maps
    // (purchaseResolvers, activePurchaseSessions, pendingRecovery) are cleared
    // and wrong-user purchase callbacks cannot fire after account switch.
    if (Platform.OS === 'android') {
      disconnectGooglePlayBilling().catch(() => {});
    }
    setToken(null);
    setUser(null);
    setSessionExpired(false);
  }, [token]);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, isLoading, sessionExpired, clearSessionExpired, signIn, signOut }),
    [user, token, isLoading, sessionExpired, clearSessionExpired, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Internal hook (used by the public useAuth hook)
// ---------------------------------------------------------------------------

/** @internal */
export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}
