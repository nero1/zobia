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

interface ManifestFeaturesResponse {
  features: FeatureFlags;
  featureModVisibility: string[];
}

const DEFAULTS: FeatureFlags = { forum: true };

async function fetchManifestFeatures(): Promise<ManifestFeaturesResponse> {
  try {
    const res = await fetch("/api/manifest");
    if (!res.ok) return { features: DEFAULTS, featureModVisibility: [] };
    const data = (await res.json()) as {
      features?: Record<string, boolean>;
      featureModVisibility?: string[];
    };
    return {
      features: { ...DEFAULTS, ...(data.features ?? {}) },
      featureModVisibility: data.featureModVisibility ?? [],
    };
  } catch {
    return { features: DEFAULTS, featureModVisibility: [] };
  }
}

/**
 * Single shared query behind every feature-flag hook below — react-query
 * dedupes concurrent callers on this key, so mounting Navbar + Sidebar +
 * a page's FeatureGate on the same render only issues one /api/manifest
 * fetch (itself CDN/Redis-cached), keeping this well within the low Redis
 * call budget.
 */
function useManifestFeaturesQuery() {
  return useQuery<ManifestFeaturesResponse>({
    queryKey: ["manifest", "features"],
    queryFn: fetchManifestFeatures,
    staleTime: 5 * 60_000,
    placeholderData: { features: DEFAULTS, featureModVisibility: [] },
  });
}

/**
 * Public, unauthenticated feature flags (rides the same cached /api/manifest
 * fetch used by useForumConfig/useMomentsConfig/useCurrency — 5 min staleTime,
 * no extra Redis round trip). Use this to hide nav entries and gate pages for
 * features an admin has turned off, without adding new API calls.
 */
export function useFeatureFlags(): FeatureFlags {
  const { data } = useManifestFeaturesQuery();
  return data?.features ?? DEFAULTS;
}

/** Convenience for a single flag, e.g. `useFeatureEnabled("forum")`. */
export function useFeatureEnabled(key: keyof FeatureFlags): boolean {
  return useFeatureFlags()[key] ?? true;
}

/**
 * Feature keys admin has allow-listed for moderators to still see/access
 * while their master flag is off (see ZobiaManifest.featureModVisibility).
 */
export function useFeatureModVisibility(): string[] {
  const { data } = useManifestFeaturesQuery();
  return data?.featureModVisibility ?? [];
}

export interface FeatureAccessRole {
  isAdmin?: boolean;
  isModerator?: boolean;
}

export interface FeatureAccessResult {
  /** Whether the feature is enabled for regular users right now. */
  enabledForUsers: boolean;
  /** Whether the current viewer may see a nav link / access the page. */
  accessible: boolean;
  /** Show a small "disabled for users" indicator (staff viewing an off feature). */
  showDisabledMarker: boolean;
}

/**
 * Resolves nav-link visibility and page access for a single feature flag,
 * honoring the "mods can access while disabled" allow-list. Pure function so
 * it can be reused both client-side (nav, FeatureGate) and is mirrored
 * server-side in lib/manifest/featureAccess.ts for page-level 404 gating.
 */
export function resolveFeatureAccess(
  enabled: boolean,
  modVisible: boolean,
  role: FeatureAccessRole
): FeatureAccessResult {
  if (enabled) return { enabledForUsers: true, accessible: true, showDisabledMarker: false };
  if (role.isAdmin) return { enabledForUsers: false, accessible: true, showDisabledMarker: true };
  if (role.isModerator && modVisible) {
    return { enabledForUsers: false, accessible: true, showDisabledMarker: true };
  }
  return { enabledForUsers: false, accessible: false, showDisabledMarker: false };
}

/** Convenience hook combining useFeatureFlags + useFeatureModVisibility for one key. */
export function useFeatureAccess(key: keyof FeatureFlags, role: FeatureAccessRole): FeatureAccessResult {
  const flags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();
  return resolveFeatureAccess(flags[key] ?? true, modVisibleKeys.includes(key as string), role);
}
