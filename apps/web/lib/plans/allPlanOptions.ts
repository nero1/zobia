/**
 * lib/plans/allPlanOptions.ts
 *
 * Single source of truth for "every plan/tier that exists on the platform",
 * for UI that needs to list them all (e.g. the announcement recipients
 * picker at /gate44/announcements). Combines:
 *   - Personal plans (shared/types Plan: free/plus/pro/max)
 *   - Business tiers (lib/business/limits.ts BUSINESS_TIER_ORDER, prefixed
 *     "business_" so they don't collide with personal plan values in the
 *     same target_plans text[] column)
 *
 * No DB/server-only imports — safe to import from client components. Note:
 * lib/business/limits.ts itself pulls in the manifest/DB layer, so only its
 * BusinessTier *type* is imported here (type-only imports are erased at
 * compile time — nothing server-only ends up in the client bundle). The
 * tier list below is kept in sync with that module's BUSINESS_TIER_ORDER by
 * the `Record<BusinessTier, ...>` on BUSINESS_LABELS: adding a tier to the
 * BusinessTier union without adding it here fails the TypeScript build.
 */

import type { BusinessTier } from "@/lib/business/limits";

/** Canonical personal plan slugs — mirrors shared/types `Plan`. */
export const PERSONAL_PLANS = ["free", "plus", "pro", "max"] as const;
export type PersonalPlan = (typeof PERSONAL_PLANS)[number];

/** Prefix used to distinguish a business tier from a personal plan in a shared target_plans list. */
export const BUSINESS_PLAN_PREFIX = "business_";

export function businessPlanValue(tier: BusinessTier): string {
  return `${BUSINESS_PLAN_PREFIX}${tier}`;
}

export interface PlanOption {
  value: string;
  label: string;
  isBusiness: boolean;
}

const PERSONAL_LABELS: Record<PersonalPlan, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  max: "Max",
};

const BUSINESS_LABELS: Record<BusinessTier, string> = {
  starter: "Business Starter",
  growth: "Business Growth",
  enterprise: "Business Enterprise",
};

/** Kept in sync with BusinessTier by the Record<BusinessTier, string> above (TS build fails otherwise). */
const BUSINESS_TIERS = Object.keys(BUSINESS_LABELS) as BusinessTier[];

/** Every plan/tier on the platform, personal plans first then business tiers. */
export function getAllPlanOptions(): PlanOption[] {
  const personal: PlanOption[] = PERSONAL_PLANS.map((p) => ({
    value: p,
    label: PERSONAL_LABELS[p],
    isBusiness: false,
  }));
  const business: PlanOption[] = BUSINESS_TIERS.map((tier) => ({
    value: businessPlanValue(tier),
    label: BUSINESS_LABELS[tier],
    isBusiness: true,
  }));
  return [...personal, ...business];
}

/** Personal (non-business) plan values only — used as the default-selected set for new announcements. */
export function getPersonalPlanValues(): string[] {
  return [...PERSONAL_PLANS];
}
