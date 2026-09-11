/**
 * apps/android/src/lib/hooks/useTweetsConfig.ts
 *
 * Mirrors apps/web/lib/hooks/useTweetsConfig.ts — admin-configured Tweets
 * eligibility/pricing, rides the same cached manifest fetch as useCurrency.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface TweetsConfig {
  minLevel: number;
  imageCostCredits: number;
  enabled: boolean;
  imageIsFree: boolean;
}

const DEFAULTS: TweetsConfig = {
  minLevel: 2,
  imageCostCredits: 5,
  enabled: true,
  imageIsFree: false,
};

interface ManifestTweetsResponse {
  features?: { tweets?: boolean };
  tweets?: { minLevel?: number; imageCostCredits?: number };
}

async function fetchTweetsConfig(): Promise<TweetsConfig> {
  try {
    const { data } = await apiClient.get<ManifestTweetsResponse>('/manifest');
    const imageCostCredits = data.tweets?.imageCostCredits ?? DEFAULTS.imageCostCredits;
    return {
      minLevel: data.tweets?.minLevel ?? DEFAULTS.minLevel,
      imageCostCredits,
      enabled: data.features?.tweets ?? DEFAULTS.enabled,
      imageIsFree: imageCostCredits <= 0,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useTweetsConfig(): TweetsConfig {
  const { data } = useQuery<TweetsConfig>({
    queryKey: ['manifest', 'tweets'],
    queryFn: fetchTweetsConfig,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}
