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
      persister: experimental_createQueryPersister({
        storage: {
          getItem: async (key: string) => {
            const val = await get(key);
            return val ?? null;
          },
          setItem: async (key: string, value: string) => {
            await set(key, value);
          },
          removeItem: async (key: string) => {
            await del(key);
          },
        },
        maxAge: STALE_TIME,
      }).persisterFn,
    },
    mutations: {
      retry: 0,
    },
  },
});
