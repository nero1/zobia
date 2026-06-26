/**
 * Zobia Social — API client.
 *
 * An Axios instance pre-configured with:
 *  - Base URL from typed env config
 *  - JSON content-type headers
 *  - JWT injection via request interceptor (reads from SecureStore)
 *  - 401 handling with silent token refresh, then signOut on failure
 *
 * Also exports the shared `QueryClient` for React Query.
 */

import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Key used to persist the JWT access token in SecureStore. */
export const JWT_KEY = 'zobia_jwt';

/** Key used to persist the refresh token in SecureStore. */
export const REFRESH_TOKEN_KEY = 'zobia_rt';

/** In-memory JWT cache to avoid SecureStore reads on every request. */
let _cachedToken: string | null = null;

/** Update the in-memory JWT cache (call from AuthContext on sign-in/out/restore). */
export function setCachedToken(t: string | null): void { _cachedToken = t; }

/** Read the in-memory JWT cache without touching SecureStore. */
export function getCachedToken(): string | null { return _cachedToken; }

// ---------------------------------------------------------------------------
// Auth event emitter
// ---------------------------------------------------------------------------

type AuthEventCallback = () => void;
const unauthCallbacks: AuthEventCallback[] = [];

/**
 * Register a callback to be invoked when the API client detects that the
 * session is no longer valid (i.e. token refresh failed).
 *
 * @returns Unsubscribe function — call it in a useEffect cleanup.
 */
export function onUnauthenticated(cb: AuthEventCallback): () => void {
  unauthCallbacks.push(cb);
  return () => {
    const idx = unauthCallbacks.indexOf(cb);
    if (idx !== -1) unauthCallbacks.splice(idx, 1);
  };
}

function notifyUnauthenticated(): void {
  unauthCallbacks.forEach((cb) => {
    try { cb(); } catch {}
  });
}

/** Callbacks fired with a fresh serialised user JSON after a successful token rotation. */
type UserUpdateCallback = (userJson: string) => void;
const userUpdateCallbacks: UserUpdateCallback[] = [];

/**
 * Register a callback to receive the updated user object whenever a silent
 * token rotation succeeds and a fresh profile is fetched from the server.
 *
 * @returns Unsubscribe function — call it in a useEffect cleanup.
 */
export function onUserUpdated(cb: UserUpdateCallback): () => void {
  userUpdateCallbacks.push(cb);
  return () => {
    const idx = userUpdateCallbacks.indexOf(cb);
    if (idx !== -1) userUpdateCallbacks.splice(idx, 1);
  };
}

function notifyUserUpdated(userJson: string): void {
  userUpdateCallbacks.forEach((cb) => {
    try { cb(userJson); } catch {}
  });
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

/**
 * Shared Axios instance for all Zobia API calls.
 *
 * IMPORTANT — CSRF Origin requirement:
 * The server-side CSRF middleware (`apps/web/middleware.ts`) requires all
 * mutation requests (POST/PUT/PATCH/DELETE) to carry an `Origin` header
 * matching the API base URL. Mobile HTTP clients do NOT send Origin
 * automatically, so every own-API call MUST go through this client (which
 * sets Origin as a default header) OR use the native fetch patched in
 * `apps/expo/app/_layout.tsx` (which injects Origin for API_BASE_URL calls).
 *
 * DO NOT use raw `fetch()` for own-API mutations outside of _layout.tsx
 * bootstrap code — use `apiClient` instead.
 */
export const apiClient = axios.create({
  baseURL: `${env.API_BASE_URL}/api`,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Origin: env.API_BASE_URL,
  },
});

// Prevent concurrent refresh races
let refreshPromise: Promise<string | null> | null = null;
// BUG-RACE-04 FIX: guard so only one 401 triggers notifyUnauthenticated
let _notifiedUnauthenticated = false;

/**
 * Reset the unauthenticated notification flag so a subsequent session expiry
 * can trigger the modal again. Call this from auth context when the user
 * explicitly signs in (Bug 11 fix: replaces the 5-second setTimeout).
 */
export function resetUnauthenticatedFlag(): void {
  _notifiedUnauthenticated = false;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) return null;

      const res = await axios.post<{ accessToken: string; refreshToken?: string; expiresIn: number }>(
        `${env.API_BASE_URL}/api/auth/refresh`,
        {},
        {
          headers: {
            'X-Refresh-Token': refreshToken,
            'Content-Type': 'application/json',
            Origin: env.API_BASE_URL,
          },
          timeout: 10_000,
        }
      );

      if (res.status !== 200) return null;

      // The new access token is in the response body (mobile path)
      const newToken = res.data.accessToken;
      if (!newToken) return null;

      await SecureStore.setItemAsync(JWT_KEY, newToken);
      _cachedToken = newToken;

      // Persist the rotated refresh token so the next refresh succeeds
      const newRefreshToken = res.data.refreshToken;
      if (newRefreshToken) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, newRefreshToken);
      }

      // BUG-025 FIX: fire /users/me as a non-blocking background task so the
      // token refresh critical path is not delayed by an extra round trip.
      // The original request can proceed immediately with the new token.
      ;(async () => {
        try {
          // BUG-DATA-09 FIX: AbortSignal.timeout() is not available on all
          // Android versions — use a manual AbortController + setTimeout instead.
          const meController = new AbortController();
          const meTimeout = setTimeout(() => meController.abort(), 5_000);
          const meRes = await fetch(`${env.API_BASE_URL}/api/users/me`, {
            headers: { Authorization: `Bearer ${newToken}`, Origin: env.API_BASE_URL },
            signal: meController.signal,
          }).finally(() => clearTimeout(meTimeout));
          if (meRes.ok) {
            const me = (await meRes.json()) as Record<string, unknown>;
            const updatedUser = {
              id: (me.id ?? me.user_id ?? '') as string,
              username: (me.username ?? '') as string,
              displayName: (me.displayName ?? me.display_name ?? '') as string,
              avatarEmoji: (me.avatarEmoji ?? me.avatar_emoji ?? '') as string,
              city: (me.city ?? '') as string,
              xp: Number(me.xp ?? me.xp_total ?? 0),
              rankTier: (me.rankTier ?? me.rank_name ?? 'Beginner') as string,
              plan: (me.plan ?? 'free') as string,
              isAdmin: Boolean(me.isAdmin ?? me.is_admin ?? false),
              isModerator: Boolean(me.isModerator ?? me.is_moderator ?? false),
              isCreator: Boolean(me.isCreator ?? me.is_creator ?? false),
              onboardingCompleted: Boolean(me.onboardingCompleted ?? me.onboarding_completed ?? false),
            };
            const userJson = JSON.stringify(updatedUser);
            await SecureStore.setItemAsync('zobia_user', userJson);
            notifyUserUpdated(userJson);
          }
        } catch {}
      })();

      return newToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Request interceptor — attach stored JWT as Bearer token.
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = _cachedToken ?? await SecureStore.getItemAsync(JWT_KEY);
    if (token && !_cachedToken) _cachedToken = token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// Response interceptor — handle 401 with silent refresh, then sign out.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retried?: boolean };

    if (error.response?.status === 401 && !originalRequest._retried) {
      originalRequest._retried = true;

      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      }

      // Refresh failed — clear credentials and notify AuthContext
      // BUG-RACE-04 FIX: only notify once even if multiple 401s arrive concurrently
      await Promise.all([
        SecureStore.deleteItemAsync(JWT_KEY),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.deleteItemAsync('zobia_user'),
      ]);
      if (!_notifiedUnauthenticated) {
        _notifiedUnauthenticated = true;
        notifyUnauthenticated();
        // Flag is only reset via resetUnauthenticatedFlag() when the user
        // explicitly signs in — prevents duplicate session-expired modals.
      }
    }

    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// React Query client
// ---------------------------------------------------------------------------

/**
 * Shared QueryClient for the entire app.
 *
 * - staleTime: 60 s — avoids excessive re-fetches on tab focus
 * - retry: 2 — retries failed requests twice before showing an error
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: (failureCount, error) => {
        // Never retry 4xx client errors — they won't succeed on retry
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

// ---------------------------------------------------------------------------
// React Query lifecycle wiring (React Native)
// ---------------------------------------------------------------------------
//
// Bridge React Query's focus/online managers to RN AppState + NetInfo. This is
// what makes polling adaptive without per-screen code: when the app is
// backgrounded, focus goes false and `refetchInterval` timers PAUSE (so chat
// screens stop polling the API while not in view); on foreground they resume
// and stale queries refetch immediately for an instant catch-up. NetInfo drives
// `onlineManager` so a reconnect also triggers a catch-up.

focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (Platform.OS !== 'web') handleFocus(status === 'active');
  });
  return () => sub.remove();
});

onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
  });
});
