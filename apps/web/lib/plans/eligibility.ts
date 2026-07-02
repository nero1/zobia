/**
 * lib/plans/eligibility.ts
 *
 * Shared helper for "which plans/prestige tiers can use this feature"
 * checks, driven by admin-configurable x_manifest JSON list values.
 *
 * Used by the profile privacy toggles (users/me/privacy) and the Profile
 * Stats tier gate (users/[userId]/stats) — any future feature gated the
 * same way (a JSON array of plan slugs and/or `prestige_N` entries stored
 * under an x_manifest key) should reuse this instead of re-implementing
 * the eligibility check.
 */

import { getManifestValue } from "@/lib/manifest";

/**
 * Reads an x_manifest key expected to hold a JSON array of plan slugs
 * (and/or `prestige_N` entries), falling back to `fallback` if the key is
 * missing or fails to parse.
 */
export async function getAllowedPlans(key: string, fallback: string[]): Promise<string[]> {
  try {
    const raw = await getManifestValue(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Checks whether a user qualifies against an allow-list that may contain
 * plan slugs (e.g. 'pro') and/or prestige-tier entries (e.g. 'prestige_1',
 * meaning prestige_count >= 1).
 */
export function isPlanEligible(
  userPlan: string,
  prestigeCount: number,
  allowedList: string[]
): boolean {
  const plan = userPlan.toLowerCase();
  if (allowedList.includes(plan)) return true;
  for (const entry of allowedList) {
    const m = /^prestige_(\d+)$/.exec(entry);
    if (m && prestigeCount >= parseInt(m[1], 10)) return true;
  }
  return false;
}
