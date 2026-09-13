/**
 * components/providers/ReactQueryProvider.tsx
 *
 * TanStack React Query client provider.
 * Wraps the app so any component can use useQuery / useMutation.
 */

"use client";

import { useEffect, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  hydrateQueryClient,
  persistQueryClient,
  setQueryCacheOwner,
} from "@/lib/offline/queryPersist";
import { useCurrentUserId } from "@/lib/hooks/useCurrentUserId";

interface ReactQueryProviderProps {
  children: React.ReactNode;
}

/**
 * Provides a QueryClient to the component tree.
 * Client is created once per React tree mount so it persists across navigations.
 */
export function ReactQueryProvider({ children }: ReactQueryProviderProps) {
  const currentUserId = useCurrentUserId();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes
            retry: (failureCount, error: unknown) => {
              const status = (error as { response?: { status?: number } })?.response?.status;
              // Do not retry on 4xx errors
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 3;
            },
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  // Offline-first: rehydrate the last persisted cache on mount (synchronously
  // before paint where possible) and keep persisting changes thereafter.
  //
  // The first hydration happens against the anonymous bucket because the
  // signed-in user is not known until /api/users/me resolves. As soon as it
  // does, `setQueryCacheOwner` below switches buckets: it clears whatever was
  // hydrated, purges other accounts' snapshots from this device and rehydrates
  // the right one. See lib/offline/queryPersist.ts for why scoping per user
  // rather than denylisting "sensitive" keys is the correct shape of defence.
  const [hydrated] = useState(() => {
    hydrateQueryClient(queryClient);
    return true;
  });
  useEffect(() => {
    void hydrated;
    return persistQueryClient(queryClient);
  }, [queryClient, hydrated]);

  // `undefined` means the identity lookup is still in flight — do not switch
  // buckets yet, or we would clear the cache on every mount. `null` is a
  // settled answer ("signed out") and is handled like any other owner change.
  useEffect(() => {
    if (currentUserId === undefined) return;
    setQueryCacheOwner(queryClient, currentUserId);
  }, [queryClient, currentUserId]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
