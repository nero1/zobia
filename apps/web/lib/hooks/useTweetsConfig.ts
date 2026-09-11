"use client";

import { useQuery } from "@tanstack/react-query";

export interface TweetsConfig {
  minLevel: number;
  imageCostCredits: number;
  enabled: boolean;
  /** True when the image cost is 0 — image uploads are free. */
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
    const res = await fetch("/api/manifest");
    if (!res.ok) return DEFAULTS;
    const data = (await res.json()) as ManifestTweetsResponse;
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

/**
 * Returns the admin-configured Tweets eligibility/pricing rules. Rides the
 * same cached /api/manifest fetch used by useCurrency/useMomentsConfig (5 min
 * staleTime) so this never adds an extra Redis round trip of its own.
 */
export function useTweetsConfig(): TweetsConfig {
  const { data } = useQuery<TweetsConfig>({
    queryKey: ["manifest", "tweets"],
    queryFn: fetchTweetsConfig,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}
