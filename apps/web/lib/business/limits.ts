/**
 * lib/business/limits.ts
 *
 * Per-tier Business Accounts limits: Business Page slot counts, and stats
 * depth/breadth (mirrors the Blogs stats-tier convention — lib/blogs/limits.ts
 * STATS_TIER — rather than inventing a new one). Admin-configurable via
 * x_manifest, read through the shared manifest cache (15s memory + 60s
 * Redis) to keep Redis calls minimal — same idiom as lib/blogs/limits.ts /
 * lib/plans/saveSlots.ts.
 */

import { getManifestValue } from "@/lib/manifest";

export type BusinessTier = "starter" | "growth" | "enterprise";

export const BUSINESS_TIER_ORDER: Record<BusinessTier, number> = {
  starter: 1,
  growth: 2,
  enterprise: 3,
};

export function normalizeBusinessTier(tier: string | null | undefined): BusinessTier {
  return tier === "growth" || tier === "enterprise" ? tier : "starter";
}

/** Max Business Pages a business account may create, per tier. */
const DEFAULT_PAGE_LIMIT: Record<BusinessTier, number> = {
  starter: 2,
  growth: 10,
  enterprise: 50,
};

export async function getBusinessPageLimit(tier: string): Promise<number> {
  const key = normalizeBusinessTier(tier);
  const raw = await getManifestValue(`business_page_limit_${key}`);
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_PAGE_LIMIT[key];
}

/** Stats depth: 'basic' | 'more' | 'detailed' | 'detailed_export' — same shape as Blogs. */
export const BUSINESS_STATS_TIER: Record<BusinessTier, "basic" | "more" | "detailed" | "detailed_export"> = {
  starter: "basic",
  growth: "more",
  enterprise: "detailed_export",
};

export function getBusinessStatsTier(tier: string): "basic" | "more" | "detailed" | "detailed_export" {
  return BUSINESS_STATS_TIER[normalizeBusinessTier(tier)];
}

/** Minimum tier required to submit a Sponsored Quest for moderation (PRD §17 — Growth+ gets Quest Marketplace access). */
const SPONSORED_QUEST_MIN_TIER: BusinessTier = "growth";

export function canSubmitSponsoredQuests(tier: string): boolean {
  return BUSINESS_TIER_ORDER[normalizeBusinessTier(tier)] >= BUSINESS_TIER_ORDER[SPONSORED_QUEST_MIN_TIER];
}

/** How business-submitted Sponsored Quests are moderated. */
export async function getSponsoredQuestModerationMode(): Promise<"manual" | "ai"> {
  const raw = await getManifestValue("sponsored_quest_moderation_mode");
  return raw === "ai" ? "ai" : "manual";
}

export async function getSponsoredQuestAiAutoApproveThreshold(): Promise<number> {
  const raw = await getManifestValue("sponsored_quest_ai_auto_approve_threshold");
  const parsed = raw != null ? parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  return 0.85;
}

/** Days after a self-service tier downgrade before extra pages/adverts are cut off. Uniform across tiers. */
export async function getBusinessDowngradeGraceDays(): Promise<number> {
  const raw = await getManifestValue("business_downgrade_grace_days");
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return 30;
}

export const BUSINESS_PLAN_DEFAULTS = {
  pageLimit: DEFAULT_PAGE_LIMIT,
  statsTier: BUSINESS_STATS_TIER,
};
