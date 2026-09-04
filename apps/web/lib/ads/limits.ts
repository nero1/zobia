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
 * Admin-configurable ad eligibility rules (x_manifest, see migration
 * 0014_ads_advertiser_wallet.sql). Defaults match the platform's original
 * behavior: business-account-only, KYC tier 1+, no personal/free-account access.
 */
export interface AdsAdminConfig {
  allowPersonalAccounts: boolean;
  requireKyc: boolean;
  minKycTier: number;
  allowFreeAccounts: boolean;
  minLevelFreeAccounts: number;
  enforceMinLevelPaidBusiness: boolean;
  minLevelPaidBusiness: number;
  advertiserGraceDays: number;
}

async function boolManifest(key: string, fallback: boolean): Promise<boolean> {
  const raw = await getManifestValue(key);
  if (raw == null) return fallback;
  return raw === "true";
}

async function intManifest(key: string, fallback: number): Promise<number> {
  const raw = await getManifestValue(key);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function getAdsAdminConfig(): Promise<AdsAdminConfig> {
  const [
    allowPersonalAccounts,
    requireKyc,
    minKycTier,
    allowFreeAccounts,
    minLevelFreeAccounts,
    enforceMinLevelPaidBusiness,
    minLevelPaidBusiness,
    advertiserGraceDays,
  ] = await Promise.all([
    boolManifest("ad_allow_personal_accounts", false),
    boolManifest("ad_require_kyc", true),
    intManifest("ad_min_kyc_tier_to_advertise", 1),
    boolManifest("ad_allow_free_accounts", false),
    intManifest("ad_min_level_free_accounts", 5),
    boolManifest("ad_enforce_min_level_paid_business", false),
    intManifest("ad_min_level_paid_business", 1),
    intManifest("ad_advertiser_grace_days", 14),
  ]);
  return {
    allowPersonalAccounts,
    requireKyc,
    minKycTier,
    allowFreeAccounts,
    minLevelFreeAccounts,
    enforceMinLevelPaidBusiness,
    minLevelPaidBusiness,
    advertiserGraceDays,
  };
}

/**
 * A user may submit self-service ad campaigns when, per the admin config above:
 *  - they own an active+verified Business Account, OR (if allowed) advertise
 *    personally without one; AND
 *  - their plan/level clears the configured gate (free accounts need
 *    `allowFreeAccounts` + `minLevelFreeAccounts`; paid/business accounts
 *    only need a level if `enforceMinLevelPaidBusiness` is on); AND
 *  - if `requireKyc`, their `users.kyc_tier` is at least `minKycTier`.
 */
export interface AdvertiserEligibility {
  eligible: boolean;
  reason?: string;
  businessAccountId?: string;
  businessTier?: string;
  /** Which identity this user could advertise as — used to build the advertiser picker. */
  canAdvertiseAsPersonal: boolean;
  canAdvertiseAsBusiness: boolean;
  /** Drives which "Getting started" buttons the /ads hub shows. */
  needsBusinessAccount?: boolean;
  needsKyc?: boolean;
}

export async function checkAdvertiserEligibility(userId: string): Promise<AdvertiserEligibility> {
  const config = await getAdsAdminConfig();

  const { rows } = await db.query<{
    id: string | null;
    tier: string | null;
    verified: boolean | null;
    status: string | null;
    kyc_tier: number;
    plan: string;
    rank_level: number;
  }>(
    `SELECT ba.id, ba.tier, ba.verified, ba.status, u.kyc_tier, COALESCE(u.plan, 'free') AS plan, COALESCE(u.rank_level, 1) AS rank_level
     FROM users u
     LEFT JOIN business_accounts ba ON ba.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return { eligible: false, reason: "Account not found.", canAdvertiseAsPersonal: false, canAdvertiseAsBusiness: false };

  const hasUsableBusinessAccount = !!row.id && row.status === "active" && row.verified === true;
  const isPaidOrBusiness = row.plan !== "free" || hasUsableBusinessAccount;

  let eligible = false;
  let reason: string | undefined;

  if (hasUsableBusinessAccount) {
    eligible = true;
  } else if (row.id && row.status !== "active") {
    reason = "Your Business Account must be active to place ads.";
  } else if (row.id && !row.verified) {
    reason = "Your Business Account must be verified by an admin before you can place ads.";
  } else if (config.allowPersonalAccounts) {
    eligible = true;
  } else {
    reason = "You need a Business Account to place ads.";
  }

  if (eligible && !isPaidOrBusiness) {
    // Free-plan, no usable business account — the free-account gate applies.
    if (!config.allowFreeAccounts) {
      eligible = false;
      reason = "Placing ads is currently limited to paid or Business accounts.";
    } else if (row.rank_level < config.minLevelFreeAccounts) {
      eligible = false;
      reason = `Placing ads requires account level ${config.minLevelFreeAccounts}+ (you're level ${row.rank_level}).`;
    }
  } else if (eligible && isPaidOrBusiness && config.enforceMinLevelPaidBusiness && row.rank_level < config.minLevelPaidBusiness) {
    eligible = false;
    reason = `Placing ads requires account level ${config.minLevelPaidBusiness}+ (you're level ${row.rank_level}).`;
  }

  const failedOnKyc = eligible && config.requireKyc && (row.kyc_tier ?? 0) < config.minKycTier;
  if (failedOnKyc) {
    eligible = false;
    reason = `Placing ads requires identity verification (KYC Tier ${config.minKycTier}+). Complete KYC verification first.`;
  }

  // "Needs a Business Account" only makes sense to show as a call-to-action
  // when personal accounts aren't allowed at all — otherwise it's an option,
  // not a requirement.
  const needsBusinessAccount = !hasUsableBusinessAccount && !config.allowPersonalAccounts;
  const needsKyc = config.requireKyc && (row.kyc_tier ?? 0) < config.minKycTier;

  return {
    eligible,
    reason: eligible ? undefined : reason,
    businessAccountId: hasUsableBusinessAccount ? row.id! : undefined,
    businessTier: hasUsableBusinessAccount ? row.tier! : undefined,
    // Any eligible advertiser may choose to display as their personal profile
    // (a display choice); the "business account" identity additionally
    // requires an actual verified Business Account to exist.
    canAdvertiseAsPersonal: eligible,
    canAdvertiseAsBusiness: eligible && hasUsableBusinessAccount,
    needsBusinessAccount,
    needsKyc,
  };
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
