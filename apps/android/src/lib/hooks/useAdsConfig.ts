/**
 * apps/android/src/lib/hooks/useAdsConfig.ts
 *
 * Mirrors apps/web/lib/hooks/useAdsConfig.ts — admin-configured ad-system
 * exposure rules, read off the same cached /api/manifest fetch used by
 * useMomentsConfig/useForumConfig (no extra Redis round trip).
 */

import { useManifest } from '@/lib/hooks/useManifest';

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

interface ManifestAdsFeatures {
  adsSystem?: boolean;
  nativeAds?: boolean;
  instreamAds?: boolean;
  boostedPosts?: boolean;
}

interface ManifestAds {
  roomInstreamInterval?: number;
}

export function useAdsConfig(): AdsConfig {
  const manifest = useManifest();
  const features = manifest?.features as ManifestAdsFeatures | undefined;
  const ads = manifest?.ads as ManifestAds | undefined;
  return {
    adsSystemEnabled: features?.adsSystem ?? DEFAULTS.adsSystemEnabled,
    nativeAdsEnabled: features?.nativeAds ?? DEFAULTS.nativeAdsEnabled,
    instreamAdsEnabled: features?.instreamAds ?? DEFAULTS.instreamAdsEnabled,
    boostedPostsEnabled: features?.boostedPosts ?? DEFAULTS.boostedPostsEnabled,
    roomInstreamInterval: ads?.roomInstreamInterval ?? DEFAULTS.roomInstreamInterval,
  };
}
