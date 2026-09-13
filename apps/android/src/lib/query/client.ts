/**
 * apps/android/src/lib/query/client.ts
 *
 * TanStack Query client with IndexedDB offline persistence.
 * Adapted from apps/expo/lib/api/client.ts (QueryClient config).
 * Adds idb-keyval + @tanstack/query-persist-client-core for offline-first.
 */

import { QueryClient } from '@tanstack/react-query';
import { experimental_createQueryPersister } from '@tanstack/query-persist-client-core';
import { get, set, del } from 'idb-keyval';
import { scopedCacheKey } from './cacheOwner';

const STALE_TIME = 24 * 60 * 60 * 1000;  // 24 hours
const GC_TIME = 7 * 24 * 60 * 60 * 1000; // 7 days

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: GC_TIME,
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      persister: (experimental_createQueryPersister({
        storage: {
          // Every key is namespaced with the signed-in user's id. IndexedDB is
          // scoped to the app, not the account, so without this a second user
          // signing in on the same device would restore the first user's
          // cached data. See ./cacheOwner.ts.
          getItem: async (key: string) => {
            const val = await get(scopedCacheKey(key));
            return val ?? null;
          },
          setItem: async (key: string, value: string) => {
            await set(scopedCacheKey(key), value);
          },
          removeItem: async (key: string) => {
            await del(scopedCacheKey(key));
          },
        },
        maxAge: STALE_TIME,
        // `refetchOnRestore` (default true) makes persisterFn fire an
        // untracked `query.fetch()` right after restoring stale data from
        // IndexedDB — that call's rejection is never awaited/caught inside
        // the library, so an expired token on relaunch surfaces as an
        // unhandled promise rejection instead of a normal query error.
        // Disabled here; the mounting observer's own refetchOnMount still
        // revalidates stale data through the properly-handled fetch path.
        refetchOnRestore: false,
      }).persisterFn),
    },
    mutations: {
      retry: 0,
    },
  },
});
