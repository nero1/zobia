"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Public feature-flag map, keyed exactly like `manifest.features.*`
 * (see lib/manifest/index.ts). Extend this type as more flags need
 * client-side gating (nav visibility, page access).
 */
export interface FeatureFlags {
  forum: boolean;
  [key: string]: boolean;
}

const DEFAULTS: FeatureFlags = { forum: true };

async function fetchFeatureFlags(): Promise<FeatureFlags> {
  try {
    const res = await fetch("/api/manifest");
    if (!res.ok) return DEFAULTS;
    const data = (await res.json()) as { features?: Record<string, boolean> };
    return { ...DEFAULTS, ...(data.features ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Public, unauthenticated feature flags (rides the same cached /api/manifest
 * fetch used by useForumConfig/useMomentsConfig/useCurrency — 5 min staleTime,
 * no extra Redis round trip). Use this to hide nav entries and gate pages for
 * features an admin has turned off, without adding new API calls.
 */
export function useFeatureFlags(): FeatureFlags {
  const { data } = useQuery<FeatureFlags>({
    queryKey: ["manifest", "features"],
    queryFn: fetchFeatureFlags,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}

/** Convenience for a single flag, e.g. `useFeatureEnabled("forum")`. */
export function useFeatureEnabled(key: keyof FeatureFlags): boolean {
  return useFeatureFlags()[key] ?? true;
}
