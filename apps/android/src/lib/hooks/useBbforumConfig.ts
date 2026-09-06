/**
 * apps/android/src/lib/hooks/useBbforumConfig.ts
 *
 * Mirrors useForumConfig.ts but for the old-school BB-style forum
 * (manifest.bbforum) — reads the admin-configured level gate, reward, and
 * image-cost settings off the same cached /api/manifest fetch used by
 * useCurrency/useForumConfig (no extra Redis round trip).
 */

import { useManifest } from '@/lib/hooks/useManifest';

export interface BbforumConfig {
  minLevelToPost: number;
  imageCostCredits: number;
  imageCostStars: number;
  enabled: boolean;
}

const DEFAULTS: BbforumConfig = {
  minLevelToPost: 2,
  imageCostCredits: 0,
  imageCostStars: 0,
  enabled: true,
};

interface ManifestBbforum {
  minLevelToPost?: number;
  imageCostCredits?: number;
  imageCostStars?: number;
}

export function useBbforumConfig(): BbforumConfig {
  const manifest = useManifest();
  const bbforum = manifest?.bbforum as ManifestBbforum | undefined;
  const enabled = (manifest?.features as { bbforum?: boolean } | undefined)?.bbforum;
  return {
    minLevelToPost: bbforum?.minLevelToPost ?? DEFAULTS.minLevelToPost,
    imageCostCredits: bbforum?.imageCostCredits ?? DEFAULTS.imageCostCredits,
    imageCostStars: bbforum?.imageCostStars ?? DEFAULTS.imageCostStars,
    enabled: enabled ?? DEFAULTS.enabled,
  };
}
