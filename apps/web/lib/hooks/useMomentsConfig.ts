"use client";

import { useQuery } from "@tanstack/react-query";

export interface MomentsConfig {
  costCredits: number;
  costStars: number;
  minLevel: number;
  enabled: boolean;
  /** True when both costs are 0 — Moments are free to share. */
  isFree: boolean;
}

const DEFAULTS: MomentsConfig = {
  costCredits: 100,
  costStars: 1,
  minLevel: 2,
  enabled: true,
  isFree: false,
};

interface ManifestMomentsResponse {
  features?: { moments?: boolean };
  moments?: { costCredits?: number; costStars?: number; minLevel?: number };
}

async function fetchMomentsConfig(): Promise<MomentsConfig> {
  try {
    const res = await fetch("/api/manifest");
    if (!res.ok) return DEFAULTS;
    const data = (await res.json()) as ManifestMomentsResponse;
    const costCredits = data.moments?.costCredits ?? DEFAULTS.costCredits;
    const costStars = data.moments?.costStars ?? DEFAULTS.costStars;
    return {
      costCredits,
      costStars,
      minLevel: data.moments?.minLevel ?? DEFAULTS.minLevel,
      enabled: data.features?.moments ?? DEFAULTS.enabled,
      isFree: costCredits <= 0 && costStars <= 0,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Returns the admin-configured Zobia Moments pricing/eligibility rules.
 * Rides the same cached /api/manifest fetch used by useCurrency (5 min
 * staleTime) so this never adds an extra Redis round trip of its own.
 */
export function useMomentsConfig(): MomentsConfig {
  const { data } = useQuery<MomentsConfig>({
    queryKey: ["manifest", "moments"],
    queryFn: fetchMomentsConfig,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}
