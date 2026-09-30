/**
 * lib/tweets/selfRetweetCap.ts
 *
 * Pure rule for how many times a user may retweet their OWN Tweet. The
 * config is admin-editable (x_manifest, Admin > Config > "Tweets").
 */

export interface SelfRetweetCapInput {
  plan: string | null;
  rankNumber: number;
  /** `business_accounts.tier` of an active business account (starter/growth/enterprise), if any. */
  businessTier: string | null;
}

/**
 * How many times a user may retweet their OWN Tweet. Highest of: 1 (everyone),
 * the fixed level-unlock cap (non-paid accounts at/above the admin level; a
 * level of 0 turns the unlock off), and the admin's per-plan / per-business-tier
 * cap. Pure — the config comes from the manifest.
 */
export function computeSelfRetweetCap(
  user: SelfRetweetCapInput,
  cfg: { selfRetweetLevelMin: number; selfRetweetLevelMax: number; selfRetweetPlanCaps: Record<string, number> }
): number {
  let cap = 1;
  if (cfg.selfRetweetLevelMin > 0 && user.rankNumber >= cfg.selfRetweetLevelMin) {
    cap = Math.max(cap, cfg.selfRetweetLevelMax);
  }
  const plan = (user.plan ?? "free").toLowerCase();
  cap = Math.max(cap, cfg.selfRetweetPlanCaps[plan] ?? 1);
  if (user.businessTier) {
    cap = Math.max(cap, cfg.selfRetweetPlanCaps[`business_${user.businessTier.toLowerCase()}`] ?? 1);
  }
  return cap;
}
