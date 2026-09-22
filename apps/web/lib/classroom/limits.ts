/**
 * lib/classroom/limits.ts
 *
 * Stats depth for the classroom creator panel, gated by the creator's Zobia
 * plan AND creator tier — mirroring lib/blogs/limits.ts STATS_TIER (plan)
 * and the PRD creator-tier table (§ Creator Tiers: "Verified Creator —
 * advanced analytics"). The higher of the two wins.
 *
 *   basic    totals only (members, paid members, revenue, posts, lessons)
 *   more     + 7/30-day activity, completion + quiz pass rates, shares/views
 *   detailed + 30-day daily series, per-lesson funnel, top contributors,
 *              view→enrolment conversion
 */

import type { Plan } from "@zobia/types";

export type ClassroomStatsTier = "basic" | "more" | "detailed";

const TIER_RANK: Record<ClassroomStatsTier, number> = { basic: 0, more: 1, detailed: 2 };

export const CLASSROOM_STATS_TIER_BY_PLAN: Record<Plan, ClassroomStatsTier> = {
  free: "basic",
  plus: "more",
  pro: "detailed",
  max: "detailed",
};

export const CLASSROOM_STATS_TIER_BY_CREATOR_TIER: Record<string, ClassroomStatsTier> = {
  rookie: "basic",
  rising: "more",
  verified: "detailed",
  elite: "detailed",
  icon: "detailed",
};

export function resolveClassroomStatsTier(plan: string | null | undefined, creatorTier: string | null | undefined): ClassroomStatsTier {
  const byPlan = CLASSROOM_STATS_TIER_BY_PLAN[(plan ?? "free") as Plan] ?? "basic";
  const byTier = CLASSROOM_STATS_TIER_BY_CREATOR_TIER[creatorTier ?? "rookie"] ?? "basic";
  return TIER_RANK[byPlan] >= TIER_RANK[byTier] ? byPlan : byTier;
}

export function statsTierAtLeast(tier: ClassroomStatsTier, min: ClassroomStatsTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}
