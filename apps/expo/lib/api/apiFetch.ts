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
  return fetch(input, { ...init, headers });
}
