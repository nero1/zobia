/**
 * apps/android/src/lib/query/client.ts
 *
 * TanStack Query client with IndexedDB offline persistence.
 * Adapted from apps/expo/lib/api/client.ts (QueryClient config).
 * Adds idb-keyval + @tanstack/query-persist-client-core for offline-first.
 */

import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';
import { experimental_createQueryPersister } from '@tanstack/query-persist-client-core';
import { get, set, del } from 'idb-keyval';
import { scopedCacheKey } from './cacheOwner';

/**
 * `@tanstack/query-persist-client-core` depends on a newer PATCH of
 * `@tanstack/query-core` than `@tanstack/react-query` does, so npm installs a
 * second, nested copy of it. `QueryClient` carries `#private` fields, which
 * makes the two copies NOMINALLY incompatible to TypeScript even though they
 * are structurally identical and resolve to the same runtime behaviour — so
 * `tsc -b` rejects `persisterFn` where the persister and the QueryClient meet.
 *
 * The clean fix is to dedupe the two copies to one version, but npm will not
 * apply a workspace-root `overrides` entry here without a full lockfile
 * regeneration, which is a far larger and riskier change than the problem
 * warrants. This narrow, single-call-site type is the containment instead: it
 * asserts only the shape of the `persister` option, changes nothing at
 * runtime, and can be deleted the moment the two packages agree on a
 * query-core version. It routes through `unknown` because the two
 * `QueryClient` identities do not structurally overlap as far as TypeScript is
 * concerned, which is the whole problem.
 */
type PersisterOption = NonNullable<
  NonNullable<QueryClientConfig['defaultOptions']>['queries']
>['persister'];

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
      }).persisterFn) as unknown as PersisterOption,
    },
    mutations: {
      retry: 0,
    },
  },
});
