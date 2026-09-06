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
  /** Feature keys moderators may still see/access while their master flag is off. */
  featureModVisibility?: string[];
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

export function useFeatureModVisibility(): string[] {
  const manifest = useManifest();
  return manifest?.featureModVisibility ?? [];
}

export interface FeatureAccessRole {
  isAdmin?: boolean;
  isModerator?: boolean;
}

export interface FeatureAccessResult {
  accessible: boolean;
  showDisabledMarker: boolean;
}

/**
 * Mirrors apps/web/lib/hooks/useFeatureFlags.ts's resolveFeatureAccess() —
 * kept in sync manually since this app has its own bundle/build.
 */
export function resolveFeatureAccess(
  enabled: boolean,
  modVisible: boolean,
  role: FeatureAccessRole
): FeatureAccessResult {
  if (enabled) return { accessible: true, showDisabledMarker: false };
  if (role.isAdmin) return { accessible: true, showDisabledMarker: true };
  if (role.isModerator && modVisible) return { accessible: true, showDisabledMarker: true };
  return { accessible: false, showDisabledMarker: false };
}
