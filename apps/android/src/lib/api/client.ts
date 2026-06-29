/**
 * Zobia Social — Android API client.
 *
 * Adapted from apps/expo/lib/api/client.ts.
 * Changes:
 *  - expo-secure-store → @capacitor/preferences
 *  - AppState (React Native) → @capacitor/app
 *  - NetInfo → @capacitor/network
 *  - expo-constants → import.meta.env (Vite)
 */

import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const JWT_KEY = 'zobia_jwt';
export const REFRESH_TOKEN_KEY = 'zobia_rt';

let _cachedToken: string | null = null;

export function setCachedToken(t: string | null): void { _cachedToken = t; }
export function getCachedToken(): string | null { return _cachedToken; }

// ---------------------------------------------------------------------------
// Auth event emitter
// ---------------------------------------------------------------------------

type AuthEventCallback = () => void;
const unauthCallbacks: AuthEventCallback[] = [];

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

type UserUpdateCallback = (userJson: string) => void;
const userUpdateCallbacks: UserUpdateCallback[] = [];

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

export const apiClient = axios.create({
  baseURL: `${env.VITE_API_BASE_URL}/api`,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

let refreshPromise: Promise<string | null> | null = null;
let _notifiedUnauthenticated = false;

export function resetUnauthenticatedFlag(): void {
  _notifiedUnauthenticated = false;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const { value: refreshToken } = await Preferences.get({ key: REFRESH_TOKEN_KEY });
      if (!refreshToken) return null;

      const res = await axios.post<{ accessToken: string; refreshToken?: string; expiresIn: number }>(
        `${env.VITE_API_BASE_URL}/api/auth/refresh`,
        {},
        {
          headers: {
            'X-Refresh-Token': refreshToken,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        }
      );

      if (res.status !== 200) return null;

      const newToken = res.data.accessToken;
      if (!newToken) return null;

      await Preferences.set({ key: JWT_KEY, value: newToken });
      _cachedToken = newToken;

      const newRefreshToken = res.data.refreshToken;
      if (newRefreshToken) {
        await Preferences.set({ key: REFRESH_TOKEN_KEY, value: newRefreshToken });
      }

      // Background user update (non-blocking)
      ;(async () => {
        try {
          const meController = new AbortController();
          const meTimeout = setTimeout(() => meController.abort(), 5_000);
          const meRes = await fetch(`${env.VITE_API_BASE_URL}/api/users/me`, {
            headers: { Authorization: `Bearer ${newToken}` },
            signal: meController.signal,
          }).finally(() => clearTimeout(meTimeout));
          if (meRes.ok) {
            const meBody = (await meRes.json()) as Record<string, unknown>;
            const me = (meBody.user ?? meBody.data ?? meBody) as Record<string, unknown>;
            const updatedUser = {
              id: (me.id ?? me.user_id ?? '') as string,
              email: (me.email ?? null) as string | null,
              username: (me.username ?? '') as string,
              plan: (me.plan ?? 'free') as string,
              is_admin: Boolean(me.is_admin ?? me.isAdmin ?? false),
              is_creator: Boolean(me.is_creator ?? me.isCreator ?? false),
              avatar_url: (me.avatar_url ?? null) as string | null,
            };
            const userJson = JSON.stringify(updatedUser);
            await Preferences.set({ key: 'zobia_user', value: userJson });
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
    if (_cachedToken) {
      config.headers.Authorization = `Bearer ${_cachedToken}`;
      return config;
    }
    const { value: token } = await Preferences.get({ key: JWT_KEY });
    if (token) {
      _cachedToken = token;
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// Response interceptor — unwrap the backend's standard { success, data, error } envelope
// and handle 401 with silent refresh, then sign out.
apiClient.interceptors.response.use(
  (response) => {
    const body = response.data as unknown;
    if (
      body &&
      typeof body === 'object' &&
      'success' in body &&
      'data' in body
    ) {
      response.data = (body as { data: unknown }).data;
    }
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retried?: boolean };

    if (error.response?.status === 401 && !originalRequest._retried) {
      originalRequest._retried = true;

      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      }

      await Promise.all([
        Preferences.remove({ key: JWT_KEY }),
        Preferences.remove({ key: REFRESH_TOKEN_KEY }),
        Preferences.remove({ key: 'zobia_user' }),
      ]);
      if (!_notifiedUnauthenticated) {
        _notifiedUnauthenticated = true;
        notifyUnauthenticated();
      }
    }

    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// React Query lifecycle wiring (Capacitor)
// ---------------------------------------------------------------------------

focusManager.setEventListener((handleFocus) => {
  let handle: { remove: () => void } | null = null;
  App.addListener('appStateChange', ({ isActive }) => {
    handleFocus(isActive);
  }).then((h) => { handle = h; });
  return () => { handle?.remove(); };
});

onlineManager.setEventListener((setOnline) => {
  // Initial check
  Network.getStatus().then((status) => {
    setOnline(status.connected);
  });
  let handle: { remove: () => void } | null = null;
  Network.addListener('networkStatusChange', (status) => {
    setOnline(status.connected);
  }).then((h) => { handle = h; });
  return () => { handle?.remove(); };
});
