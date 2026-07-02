/**
 * lib/ads/limits.ts
 *
 * Platform Advertising (PRD §17, Pillar 3) — eligibility gating and
 * per-plan ad exposure, mirroring the lib/business/limits.ts /
 * lib/blogs/limits.ts convention: thin helpers over the shared manifest
 * cache (memory → Redis → DB) so gating never costs an extra Redis round
 * trip beyond what loadManifest() already does.
 */

import { db } from "@/lib/db";
import { getManifestValue, loadManifest } from "@/lib/manifest";

export type AdsLevel = "full" | "reduced" | "none";
export type UserPlan = "free" | "plus" | "pro" | "max";

/** How many native ad slots a viewer on this plan should be shown, relative to "full". */
export async function getPlanAdsLevel(plan: string | null | undefined): Promise<AdsLevel> {
  const manifest = await loadManifest();
  const key = (plan === "plus" || plan === "pro" || plan === "max" ? plan : "free") as UserPlan;
  return manifest.ads.planAdsLevel[key];
}

/** Convenience: does this plan see ads at all? */
export function adsLevelAllowsAny(level: AdsLevel): boolean {
  return level !== "none";
}

/**
 * A user may submit self-service ad campaigns only if:
 *  - they own a `verified` Business Account, AND
 *  - their `users.kyc_tier` is at least `ad_min_kyc_tier_to_advertise` (default 1).
 * This is intentionally stricter than Sponsored Quests (Growth+ tier only) —
 * ads carry real ad spend and impressions across the whole platform, so the
 * PRD requires KYC-verified identity behind every advertiser.
 */
export interface AdvertiserEligibility {
  eligible: boolean;
  reason?: string;
  businessAccountId?: string;
  businessTier?: string;
}

export async function checkAdvertiserEligibility(userId: string): Promise<AdvertiserEligibility> {
  const { rows } = await db.query<{ id: string; tier: string; verified: boolean; status: string; kyc_tier: number }>(
    `SELECT ba.id, ba.tier, ba.verified, ba.status, u.kyc_tier
     FROM business_accounts ba
     JOIN users u ON u.id = ba.user_id
     WHERE ba.user_id = $1 LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) {
    return { eligible: false, reason: "You need a Business Account to place ads." };
  }
  if (row.status !== "active") {
    return { eligible: false, reason: "Your Business Account must be active to place ads." };
  }
  if (!row.verified) {
    return { eligible: false, reason: "Your Business Account must be verified by an admin before you can place ads." };
  }
  const minTier = await getManifestValue("ad_min_kyc_tier_to_advertise");
  const minKycTier = minTier != null ? parseInt(minTier, 10) : 1;
  if ((row.kyc_tier ?? 0) < (Number.isFinite(minKycTier) ? minKycTier : 1)) {
    return {
      eligible: false,
      reason: `Placing ads requires identity verification (KYC Tier ${minKycTier}+). Complete KYC verification first.`,
    };
  }
  return { eligible: true, businessAccountId: row.id, businessTier: row.tier };
}

/** Business account owned by this user, regardless of ad eligibility (used for read/list routes). */
export async function getOwnBusinessAccountId(userId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM business_accounts WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0]?.id ?? null;
}

/** How business-submitted ad campaigns are moderated. */
export async function getAdModerationMode(): Promise<"manual" | "ai"> {
  const manifest = await loadManifest();
  return manifest.ads.moderationMode;
}

export async function getAdAiAutoApproveThreshold(): Promise<number> {
  const manifest = await loadManifest();
  return manifest.ads.aiAutoApproveThreshold;
}

/** Effective CPM (Credits per 1000 impressions) for a placement, admin-overridable per-campaign. */
export async function getDefaultCpmCredits(): Promise<number> {
  const manifest = await loadManifest();
  return manifest.ads.defaultCpmCredits;
}

export async function getRoomInstreamInterval(): Promise<number> {
  const manifest = await loadManifest();
  return manifest.ads.roomInstreamInterval;
}
