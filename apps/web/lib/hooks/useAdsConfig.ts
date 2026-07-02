"use client";

import { useQuery } from "@tanstack/react-query";

export interface AdsConfig {
  adsSystemEnabled: boolean;
  nativeAdsEnabled: boolean;
  instreamAdsEnabled: boolean;
  boostedPostsEnabled: boolean;
  roomInstreamInterval: number;
}

const DEFAULTS: AdsConfig = {
  adsSystemEnabled: true,
  nativeAdsEnabled: true,
  instreamAdsEnabled: true,
  boostedPostsEnabled: true,
  roomInstreamInterval: 10,
};

interface ManifestAdsResponse {
  features?: { adsSystem?: boolean; nativeAds?: boolean; instreamAds?: boolean; boostedPosts?: boolean };
  ads?: { roomInstreamInterval?: number };
}

async function fetchAdsConfig(): Promise<AdsConfig> {
  try {
    const res = await fetch("/api/manifest");
    if (!res.ok) return DEFAULTS;
    const data = (await res.json()) as ManifestAdsResponse;
    return {
      adsSystemEnabled: data.features?.adsSystem ?? DEFAULTS.adsSystemEnabled,
      nativeAdsEnabled: data.features?.nativeAds ?? DEFAULTS.nativeAdsEnabled,
      instreamAdsEnabled: data.features?.instreamAds ?? DEFAULTS.instreamAdsEnabled,
      boostedPostsEnabled: data.features?.boostedPosts ?? DEFAULTS.boostedPostsEnabled,
      roomInstreamInterval: data.ads?.roomInstreamInterval ?? DEFAULTS.roomInstreamInterval,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Admin-configured ad-system exposure rules. Rides the same cached
 * /api/manifest fetch as useMomentsConfig/useCurrency (5 min staleTime) so
 * this never adds an extra Redis round trip of its own.
 */
export function useAdsConfig(): AdsConfig {
  const { data } = useQuery<AdsConfig>({
    queryKey: ["manifest", "ads"],
    queryFn: fetchAdsConfig,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}
