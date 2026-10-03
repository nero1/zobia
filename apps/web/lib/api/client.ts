import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import { markSessionExpired } from '@/lib/auth/sessionExpiredBus';
import { refreshSession } from '@/lib/auth/refreshSession';

export const apiClient = axios.create({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// WEB-AUTH-01: refreshes are single-flighted per tab and serialised across tabs
// (lib/auth/refreshSession.ts), so a burst of 401s makes one refresh call.
const refreshWebToken = refreshSession;

// Response interceptor — on 401, attempt a silent cookie-based token refresh,
// then retry the original request exactly once. The server sets the new
// access-token cookie on a successful refresh, so no manual header mutation
// is needed before retrying.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };

    if (error.response?.status === 401 && !originalRequest._retried) {
      originalRequest._retried = true;

      const refreshed = await refreshWebToken();
      if (refreshed) {
        return apiClient(originalRequest);
      }
      // Refresh failed — the session is truly gone. Raise the app-wide
      // "you've been signed out" notice so an open page (e.g. a chat room that
      // never navigated) surfaces it instead of silently swallowing the error.
      markSessionExpired();
    }

    return Promise.reject(error);
  },
);
