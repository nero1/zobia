/**
 * Zobia Social — API client.
 *
 * An Axios instance pre-configured with:
 *  - Base URL from typed env config
 *  - JSON content-type headers
 *  - JWT injection via request interceptor (reads from SecureStore)
 *  - 401 handling (clears token and fires a global auth-error event)
 *
 * Also exports the shared `QueryClient` for React Query.
 */

import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import * as SecureStore from 'expo-secure-store';
import { QueryClient } from '@tanstack/react-query';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Key used to persist the JWT in SecureStore — must match auth/context.tsx. */
export const JWT_KEY = 'zobia_jwt';

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

/** Shared Axios instance for all Zobia API calls. */
export const apiClient = axios.create({
  baseURL: env.API_BASE_URL,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

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

// Response interceptor — handle 401 globally.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Clear the stored token so the auth context can redirect to login.
      await SecureStore.deleteItemAsync(JWT_KEY);
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
