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

// ---------------------------------------------------------------------------
// Shared eligibility-list vocabulary
// ---------------------------------------------------------------------------

/** Plan slugs, cheapest to most expensive. */
export const ELIGIBILITY_PLANS = ["free", "plus", "pro", "max"] as const;
/** Prestige tiers 1-10 (see isPlanEligible: 'prestige_N' matches prestige_count >= N). */
export const ELIGIBILITY_PRESTIGE_TIERS = Array.from({ length: 10 }, (_, i) => `prestige_${i + 1}`);
/** Business account tiers (business_accounts.tier). */
export const ELIGIBILITY_BUSINESS_TIERS = ["business_starter", "business_growth", "business_enterprise"];
/** Staff roles. */
export const ELIGIBILITY_ROLES = ["role_admin", "role_moderator"];

/**
 * Builds a "select all except these plans" allow-list — every prestige tier,
 * business tier, and role is always included; only bare plan slugs are
 * excludable. Used as the default for admin-configurable eligibility lists
 * (profile privacy toggles, Profile Stats full-view gate) so higher tiers,
 * business accounts, and staff are opted in by default.
 */
export function allEligibilityOptionsExcept(excludedPlans: string[]): string[] {
  return [
    ...ELIGIBILITY_PLANS.filter((p) => !excludedPlans.includes(p)),
    ...ELIGIBILITY_PRESTIGE_TIERS,
    ...ELIGIBILITY_BUSINESS_TIERS,
    ...ELIGIBILITY_ROLES,
  ];
}

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

export interface EligibilityContext {
  /** Business account tier ('starter' | 'growth' | 'enterprise'), if the user has a business account. */
  businessTier?: string | null;
  isAdmin?: boolean;
  isModerator?: boolean;
}

/**
 * Checks whether a user qualifies against an allow-list that may contain:
 *  - plan slugs (e.g. 'pro')
 *  - prestige-tier entries (e.g. 'prestige_1', meaning prestige_count >= 1)
 *  - business tier entries (e.g. 'business_growth', matching that exact tier)
 *  - role entries ('role_admin', 'role_moderator')
 */
export function isPlanEligible(
  userPlan: string,
  prestigeCount: number,
  allowedList: string[],
  context: EligibilityContext = {}
): boolean {
  const plan = userPlan.toLowerCase();
  if (allowedList.includes(plan)) return true;

  for (const entry of allowedList) {
    const prestigeMatch = /^prestige_(\d+)$/.exec(entry);
    if (prestigeMatch && prestigeCount >= parseInt(prestigeMatch[1], 10)) return true;

    const businessMatch = /^business_(\w+)$/.exec(entry);
    if (
      businessMatch &&
      context.businessTier &&
      context.businessTier.toLowerCase() === businessMatch[1].toLowerCase()
    ) {
      return true;
    }

    if (entry === "role_admin" && context.isAdmin) return true;
    if (entry === "role_moderator" && context.isModerator) return true;
  }
  return false;
}
