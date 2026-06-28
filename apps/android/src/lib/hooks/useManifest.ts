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

const MANIFEST_STALE_TIME = 5 * 60_000;

async function fetchManifest(): Promise<Manifest> {
  const { data } = await apiClient.get<Manifest>('/manifest');
  return data ?? {};
}

export function useManifest(): Manifest | undefined {
  const { data } = useQuery<Manifest>({
    queryKey: ['manifest'],
    queryFn: fetchManifest,
    staleTime: MANIFEST_STALE_TIME,
  });
  return data;
}

export function useFeatureFlags(): ManifestFeatureFlags | undefined {
  const manifest = useManifest();
  return manifest?.features;
}
