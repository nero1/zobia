/**
 * lib/wiki/limits.ts
 *
 * Wiki creation eligibility (role/plan/level gate, admin-configurable) and
 * per-plan quotas. Mirrors lib/blogs/limits.ts's shape — all values read
 * through the shared manifest cache (15s memory + 60s Redis) to keep Redis
 * calls minimal.
 */

import { getManifestValue } from "@/lib/manifest";
import type { Plan } from "@zobia/types";

const PLAN_ORDER: Record<Plan, number> = { free: 0, plus: 1, pro: 2, max: 3 };

const DEFAULT_MAX_OWNED: Record<Plan, number> = {
  free: 1,
  plus: 3,
  pro: 10,
  max: 25,
};

const DEFAULT_MAX_PAGES: Record<Plan, number> = {
  free: 20,
  plus: 75,
  pro: 250,
  max: 1000,
};

function normalizePlan(plan: string): Plan {
  return (plan in PLAN_ORDER ? plan : "free") as Plan;
}

async function getInt(key: string, fallback: number): Promise<number> {
  const raw = await getManifestValue(key);
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Who may create a wiki: plan + creator-level + optional staff-only gate.
// Admin-editable at /gate44/wiki.
// ---------------------------------------------------------------------------

export interface WikiCreationRequirements {
  minPlan: Plan;
  minLevel: number;
  staffOnly: boolean;
}

export async function getWikiCreationRequirements(): Promise<WikiCreationRequirements> {
  const [minPlanRaw, minLevel, staffOnlyRaw] = await Promise.all([
    getManifestValue("wiki_create_required_plan"),
    getInt("wiki_create_min_level", 0),
    getManifestValue("wiki_create_restricted_to_staff"),
  ]);
  return {
    minPlan: normalizePlan(minPlanRaw ?? "free"),
    minLevel,
    staffOnly: staffOnlyRaw === "true",
  };
}

export interface WikiCreationEligibility {
  eligible: boolean;
  reason?: string;
  requirements: WikiCreationRequirements;
}

/**
 * Checks whether a user meets the site admin's wiki-creation gate. Staff
 * (moderators/admins) always pass regardless of plan/level, same convention
 * as `hasAnyRole`/guild-creation eligibility elsewhere.
 */
export async function checkWikiCreationEligibility(user: {
  plan: string;
  levelCreator: number;
  isAdmin: boolean;
  isModerator: boolean;
}): Promise<WikiCreationEligibility> {
  const requirements = await getWikiCreationRequirements();
  if (user.isAdmin || user.isModerator) return { eligible: true, requirements };

  if (requirements.staffOnly) {
    return { eligible: false, reason: "Only moderators and admins can create a wiki right now.", requirements };
  }
  if (PLAN_ORDER[normalizePlan(user.plan)] < PLAN_ORDER[requirements.minPlan]) {
    return { eligible: false, reason: `Creating a wiki requires the ${requirements.minPlan} plan or higher.`, requirements };
  }
  if (user.levelCreator < requirements.minLevel) {
    return { eligible: false, reason: `Creating a wiki requires creator level ${requirements.minLevel} or higher.`, requirements };
  }
  return { eligible: true, requirements };
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

export async function getMaxOwnedWikis(plan: string): Promise<number> {
  const key = normalizePlan(plan);
  return getInt(`wiki_max_owned_${key}`, DEFAULT_MAX_OWNED[key]);
}

export async function getMaxWikiPages(plan: string): Promise<number> {
  const key = normalizePlan(plan);
  return getInt(`wiki_max_pages_${key}`, DEFAULT_MAX_PAGES[key]);
}

export async function getMaxSelectedCollaborators(): Promise<number> {
  return getInt("wiki_max_selected_collaborators", 100);
}

export async function getWikiInviteExpiryHours(): Promise<number> {
  return getInt("wiki_invite_expiry_hours", 168);
}

// ---------------------------------------------------------------------------
// Rewards — default 1 XP / 0 Credits per the product spec, admin-configurable.
// ---------------------------------------------------------------------------

export async function getWikiCreateReward(): Promise<{ xp: number; credits: number }> {
  const [xp, credits] = await Promise.all([
    getInt("wiki_create_reward_xp", 1),
    getInt("wiki_create_reward_credits", 0),
  ]);
  return { xp, credits };
}

export async function getWikiContributeReward(): Promise<{ xp: number; credits: number }> {
  const [xp, credits] = await Promise.all([
    getInt("wiki_contribute_reward_xp", 1),
    getInt("wiki_contribute_reward_credits", 0),
  ]);
  return { xp, credits };
}

export async function getWikiDailyRewardCapCredits(): Promise<number> {
  return getInt("wiki_daily_reward_cap_credits", 50);
}

export const WIKI_PLAN_DEFAULTS = {
  maxOwned: DEFAULT_MAX_OWNED,
  maxPages: DEFAULT_MAX_PAGES,
};
