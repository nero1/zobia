/**
 * lib/manifest/featureAccess.ts
 *
 * Server-side mirror of resolveFeatureAccess() in
 * lib/hooks/useFeatureFlags.ts — kept as a tiny separate function (not a
 * shared import) because the client hook file is "use client" and this one
 * is imported from Server Components (app/(app)/layout.tsx).
 *
 * Also carries the route → feature-flag map used to 404-gate direct page
 * visits to a disabled feature (nav links already hide themselves; this
 * covers a user typing/bookmarking the URL directly).
 */

import type { ZobiaManifest } from "@/lib/manifest";

export interface FeatureAccessRole {
  isAdmin: boolean;
  isModerator: boolean;
}

/**
 * Mirrors resolveFeatureAccess() in lib/hooks/useFeatureFlags.ts.
 * enabled=true → accessible to everyone. enabled=false → only admins, or
 * moderators when the flag is in the admin-managed mod-visibility list.
 */
export function isFeatureAccessible(
  enabled: boolean,
  modVisible: boolean,
  role: FeatureAccessRole
): boolean {
  if (enabled) return true;
  if (role.isAdmin) return true;
  if (role.isModerator && modVisible) return true;
  return false;
}

type FeatureKey = keyof ZobiaManifest["features"];

interface FeatureRouteRule {
  /** First path segment this rule applies to. */
  segment: string;
  featureKey: FeatureKey;
  /**
   * Optional extra check against the full segment list (e.g. only gate
   * /profile/<id>/stats, not the rest of /profile/*). When omitted, the
   * whole segment subtree is gated.
   */
  match?: (segments: string[]) => boolean;
}

/**
 * Top-level app routes gated by a master feature flag. Add an entry here
 * whenever a new feature flag gets its own route — this is the single
 * place page-level 404 gating is driven from (see app/(app)/layout.tsx),
 * so individual page.tsx files never need to duplicate the check.
 */
const FEATURE_ROUTES: FeatureRouteRule[] = [
  { segment: "rooms", featureKey: "rooms" },
  { segment: "games", featureKey: "games" },
  { segment: "gifts", featureKey: "gifts" },
  { segment: "leaderboards", featureKey: "rankings" },
  { segment: "community-notes", featureKey: "communityNotes" },
  { segment: "nemesis", featureKey: "nemesisSystem" },
  { segment: "classroom", featureKey: "classrooms" },
  { segment: "business", featureKey: "businessAccounts" },
  { segment: "merch", featureKey: "merchStore" },
  { segment: "council", featureKey: "platformCouncil" },
  { segment: "moments", featureKey: "moments" },
  { segment: "blogs", featureKey: "blogs" },
  { segment: "kyc", featureKey: "kyc" },
  { segment: "ads", featureKey: "adsSystem" },
  { segment: "answers", featureKey: "forum" },
  { segment: "forum", featureKey: "bbforum" },
  {
    segment: "profile",
    featureKey: "profileStats",
    match: (segments) => segments.length > 0 && segments[segments.length - 1] === "stats",
  },
];

/**
 * Resolve which feature flag (if any) gates the given path segments.
 * @param segments - path segments below the (app) route group, e.g. ["profile", "abc123", "stats"]
 */
export function resolveFeatureGate(segments: string[]): FeatureKey | null {
  const first = segments[0];
  if (!first) return null;
  for (const rule of FEATURE_ROUTES) {
    if (rule.segment !== first) continue;
    if (rule.match && !rule.match(segments)) continue;
    return rule.featureKey;
  }
  return null;
}
