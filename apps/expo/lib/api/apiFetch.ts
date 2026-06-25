/**
 * lib/api/apiFetch.ts
 *
 * A named wrapper around fetch that injects Origin and Authorization headers
 * for requests to our own API. Use this instead of raw fetch() for all
 * own-API calls so that the CSRF origin check passes and JWT is included.
 *
 * BUG-26 FIX: replaces the global.fetch monkey-patch in _layout.tsx, which
 * affected every fetch call in the process including third-party SDKs.
 */

import * as SecureStore from 'expo-secure-store';
import { env } from '@/lib/env';
import { JWT_KEY } from '@/lib/api/client';

/** Total number of attempts for transient network failures (1 initial + 3 retries). */
const MAX_ATTEMPTS = 4;
/** Initial backoff delay in ms; doubles on each retry. */
const RETRY_BASE_MS = 500;

function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network error / DNS failure
  return false;
}

function isRetryableStatus(status: number, method?: string): boolean {
  // Only retry idempotent methods — POST/PATCH are unsafe to retry because
  // the server may have already partially committed (e.g. payment charged).
  const safe = !method || ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method.toUpperCase());
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

  if (!url.startsWith(env.API_BASE_URL)) {
    return fetch(input, init);
  }

  const headers = new Headers((init?.headers ?? {}) as HeadersInit);
  if (!headers.has('Origin')) {
    headers.set('Origin', env.API_BASE_URL);
  }
  if (!headers.has('Authorization')) {
    const token = await SecureStore.getItemAsync(JWT_KEY).catch(() => null);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const requestInit = { ...init, headers };
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((res) => setTimeout(res, RETRY_BASE_MS * Math.pow(2, attempt - 1)));
    }
    try {
      const response = await fetch(input, requestInit);
      if (attempt < MAX_ATTEMPTS - 1 && isRetryableStatus(response.status, init?.method)) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
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
