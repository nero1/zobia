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

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

/** Shared Axios instance for all Zobia API calls. */
export const apiClient = axios.create({
  baseURL: `${env.API_BASE_URL}/api`,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // Mobile HTTP clients don't send Origin automatically; set it explicitly so
    // the server-side CSRF origin check accepts requests from the app.
    Origin: env.API_BASE_URL,
  },
});

// Prevent concurrent refresh races
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) return null;

      const res = await axios.post<{ expiresIn: number }>(
        `${env.API_BASE_URL}/api/auth/refresh`,
        null,
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
      const newToken = (res.data as { accessToken?: string })?.accessToken;
      if (!newToken) return null;

      await SecureStore.setItemAsync(JWT_KEY, newToken);

      // Persist the rotated refresh token so the next refresh succeeds
      const newRefreshToken = (res.data as { refreshToken?: string })?.refreshToken;
      if (newRefreshToken) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, newRefreshToken);
      }

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
    const token = await SecureStore.getItemAsync(JWT_KEY);
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
      await Promise.all([
        SecureStore.deleteItemAsync(JWT_KEY),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.deleteItemAsync('zobia_user'),
      ]);
      notifyUnauthenticated();
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
      retry: 2,
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
    setOnline(Boolean(state.isConnected));
  });
});
