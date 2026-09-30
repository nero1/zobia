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

export interface SelfRetweetCapConfig {
  selfRetweetLevelCaps: Record<string, number>;
  selfRetweetPlanCaps: Record<string, number>;
}

/**
 * How many times a user may retweet their OWN Tweet: the highest of 1, the
 * level tier reached (`{ "1": 2, "5": 5 }` = level 1+ -> 2, level 5+ -> 5),
 * the admin's cap for their plan, and the cap for their business tier. Pure —
 * the config comes from the manifest.
 */
export function computeSelfRetweetCap(user: SelfRetweetCapInput, cfg: SelfRetweetCapConfig): number {
  let cap = 1;
  for (const [minLevel, levelCap] of Object.entries(cfg.selfRetweetLevelCaps)) {
    if (user.rankNumber >= Number(minLevel)) cap = Math.max(cap, levelCap);
  }
  const plan = (user.plan ?? "free").toLowerCase();
  cap = Math.max(cap, cfg.selfRetweetPlanCaps[plan] ?? 1);
  if (user.businessTier) {
    cap = Math.max(cap, cfg.selfRetweetPlanCaps[`business_${user.businessTier.toLowerCase()}`] ?? 1);
  }
  return cap;
}

/** True when some plan offers more than `cap`, i.e. upgrading would raise this user's limit. */
export function canUpgradeSelfRetweetCap(cap: number, cfg: SelfRetweetCapConfig): boolean {
  return Object.values(cfg.selfRetweetPlanCaps).some((c) => c > cap);
}
