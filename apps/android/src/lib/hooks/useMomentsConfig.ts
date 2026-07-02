/**
 * apps/android/src/lib/hooks/useMomentsConfig.ts
 *
 * Mirrors apps/web/lib/hooks/useMomentsConfig.ts — reads the admin-configured
 * Zobia Moments pricing/eligibility off the same cached /api/manifest fetch
 * used by useCurrency (no extra Redis round trip).
 */

import { useManifest } from '@/lib/hooks/useManifest';

export interface MomentsConfig {
  costCredits: number;
  costStars: number;
  minLevel: number;
  enabled: boolean;
  isFree: boolean;
}

const DEFAULTS: MomentsConfig = {
  costCredits: 100,
  costStars: 1,
  minLevel: 2,
  enabled: true,
  isFree: false,
};

interface ManifestMoments {
  costCredits?: number;
  costStars?: number;
  minLevel?: number;
}

export function useMomentsConfig(): MomentsConfig {
  const manifest = useManifest();
  const moments = manifest?.moments as ManifestMoments | undefined;
  const enabled = (manifest?.features as { moments?: boolean } | undefined)?.moments;
  const costCredits = moments?.costCredits ?? DEFAULTS.costCredits;
  const costStars = moments?.costStars ?? DEFAULTS.costStars;
  return {
    costCredits,
    costStars,
    minLevel: moments?.minLevel ?? DEFAULTS.minLevel,
    enabled: enabled ?? DEFAULTS.enabled,
    isFree: costCredits <= 0 && costStars <= 0,
  };
}
