/**
 * lib/hooks/useManifest.ts
 *
 * Shared React Query hook for the /manifest endpoint.
 * Uses a single queryKey ['manifest'] so all consumers share one cached
 * response rather than each firing their own request (ARCH-03 fix).
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared query
// ---------------------------------------------------------------------------

const MANIFEST_STALE_TIME = 5 * 60_000; // 5 minutes

async function fetchManifest(): Promise<Manifest> {
  const { data } = await apiClient.get<Manifest>('/manifest');
  return data ?? {};
}

/**
 * Returns the full manifest response.
 * Results are cached for 5 minutes and shared across all consumers.
 */
export function useManifest(): Manifest | undefined {
  const { data } = useQuery<Manifest>({
    queryKey: ['manifest'],
    queryFn: fetchManifest,
    staleTime: MANIFEST_STALE_TIME,
  });
  return data;
}

/**
 * Returns only the feature flags section of the manifest.
 * Shorthand for the most common use-case.
 */
export function useFeatureFlags(): ManifestFeatureFlags | undefined {
  const manifest = useManifest();
  return manifest?.features;
}
