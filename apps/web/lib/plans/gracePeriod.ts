/**
 * lib/plans/gracePeriod.ts
 *
 * Reads the admin-configurable grace-period settings (length in days +
 * which grace-gated features are preserved) for a personal plan or
 * business tier. Backed by x_manifest keys (migration 0042), which are
 * already cached two levels deep (15s in-process + 60s Redis — see
 * lib/manifest) so this stays cheap on the Redis free tier.
 *
 * Used by:
 *   - the daily-economy CRON sweep (lib/plans/subscriptionSweep.ts) to
 *     decide how long a lapsed subscription stays in 'grace' before data
 *     is purged.
 *   - lib/games/saves.ts to decide whether to purge a user's save slots.
 */

import { getManifestValue } from "@/lib/manifest";
import { GRACE_FEATURE_KEYS } from "@/lib/plans/graceFeatures";

export type GraceScope = "personal" | "business";

/** Personal plans that can carry a grace period (Free has no subscription to lapse). */
export const PERSONAL_GRACE_PLANS = ["plus", "pro", "max"] as const;
/** Business tiers that can carry a grace period. */
export const BUSINESS_GRACE_TIERS = ["starter", "growth", "enterprise"] as const;

/** Fallback defaults — must match migration 0042's seeded x_manifest values. */
const DEFAULT_GRACE_DAYS: Record<string, number> = {
  plus: 7,
  pro: 14,
  max: 30,
  business_starter: 7,
  business_growth: 14,
  business_enterprise: 30,
};

function manifestKeyPrefix(scope: GraceScope, planKey: string): string {
  return scope === "business" ? `business_${planKey}` : planKey;
}

/** Number of days a lapsed plan/tier stays in grace before data is purged. */
export async function getGracePeriodDays(scope: GraceScope, planKey: string): Promise<number> {
  const suffix = manifestKeyPrefix(scope, planKey);
  const raw = await getManifestValue(`grace_period_days_${suffix}`);
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_GRACE_DAYS[suffix] ?? 7;
}

/** Grace-gated feature keys (from GRACE_FEATURE_REGISTRY) preserved for this plan/tier. */
export async function getPreservedGraceFeatures(scope: GraceScope, planKey: string): Promise<string[]> {
  const suffix = manifestKeyPrefix(scope, planKey);
  try {
    const raw = await getManifestValue(`grace_period_features_${suffix}`);
    if (!raw) return ["saved_games"];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return ["saved_games"];
    return (parsed as string[]).filter((k) => GRACE_FEATURE_KEYS.includes(k));
  } catch {
    return ["saved_games"];
  }
}

export async function isFeaturePreservedDuringGrace(
  scope: GraceScope,
  planKey: string,
  featureKey: string
): Promise<boolean> {
  const preserved = await getPreservedGraceFeatures(scope, planKey);
  return preserved.includes(featureKey);
}
