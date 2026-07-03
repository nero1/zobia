/**
 * apps/android/src/lib/hooks/useManifest.ts
 *
 * Adapted from apps/expo/lib/hooks/useManifest.ts.
 * Only change: import apiClient from Android lib path.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface ManifestFeatureFlags {
  pidginAutocomplete?: boolean;
  giftsEnabled?: boolean;
  guildWarsEnabled?: boolean;
  dailyLoginBonus?: boolean;
  [key: string]: boolean | undefined;
}

export interface ManifestCurrency {
  softNameSingular?: string;
  softNamePlural?: string;
  premiumNameSingular?: string;
  premiumNamePlural?: string;
}

export interface Manifest {
  features?: ManifestFeatureFlags;
  currency?: ManifestCurrency;
  [key: string]: unknown;
}

export const MANIFEST_QUERY_KEY = ['manifest'] as const;
export const MANIFEST_STALE_TIME = 5 * 60_000;

// Exported so non-component callers (e.g. lib/ads/admob.ts) can read/refresh
// the same react-query-cached manifest via queryClient.fetchQuery/getQueryData
// instead of maintaining their own bespoke, never-expiring cache (ZB-AND-15 fix).
export async function fetchManifest(): Promise<Manifest> {
  const { data } = await apiClient.get<Manifest>('/manifest');
  return data ?? {};
}

export function useManifest(): Manifest | undefined {
  const { data } = useQuery<Manifest>({
    queryKey: MANIFEST_QUERY_KEY,
    queryFn: fetchManifest,
    staleTime: MANIFEST_STALE_TIME,
  });
  return data;
}

export function useFeatureFlags(): ManifestFeatureFlags | undefined {
  const manifest = useManifest();
  return manifest?.features;
}
