/**
 * apps/android/src/lib/api/apiFetch.ts
 *
 * Adapted from apps/expo/lib/api/apiFetch.ts.
 * Changes: expo-secure-store → @capacitor/preferences (via getCachedToken).
 *
 * Retry logic (4 attempts, exponential backoff) kept identical.
 */

import { env } from '@/lib/env';
import { getCachedToken, refreshAccessToken, setCachedToken } from '@/lib/api/client';

const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;

function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return false;
}

function isRetryableStatus(status: number, method?: string): boolean {
  const safe = !method || ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  if (!safe) return false;
  return status === 408 || status === 429 || status >= 500;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : (input as Request).url;

  if (!url.startsWith(env.VITE_API_BASE_URL)) {
    return fetch(input, init);
  }

  const headers = new Headers((init?.headers ?? {}) as HeadersInit);
  if (!headers.has('Origin')) {
    headers.set('Origin', env.VITE_API_BASE_URL);
  }
  if (!headers.has('Authorization')) {
    const token = getCachedToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const requestInit = { ...init, headers };
  let lastError: unknown;
  let didRefresh = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const baseDelay = Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), 30_000);
      await new Promise((res) => setTimeout(res, baseDelay / 2 + Math.random() * (baseDelay / 2)));
    }
    try {
      const response = await fetch(input, requestInit);

      if (response.status === 401 && !didRefresh) {
        didRefresh = true;
        const newToken = await refreshAccessToken();
        if (newToken) {
          setCachedToken(newToken);
          requestInit.headers = new Headers(requestInit.headers as HeadersInit);
          (requestInit.headers as Headers).set('Authorization', `Bearer ${newToken}`);
          continue;
        }
        return response;
      }

      if (isRetryableStatus(response.status, init?.method)) {
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < MAX_ATTEMPTS - 1) continue;
        break;
      }
      return response;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS - 1 && isRetryableError(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('apiFetch: max retries exceeded');
}
