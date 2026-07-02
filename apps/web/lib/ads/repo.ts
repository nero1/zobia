/**
 * lib/ads/repo.ts
 *
 * Platform Advertising data layer (PRD §17, Pillar 3). Campaign/creative
 * CRUD, moderation submission, budget funding and coupon redemption.
 *
 * Billing model: a campaign's Credit budget is pre-paid — funding debits
 * the advertiser's coin_balance through the existing append-only
 * coin_ledger (lib/economy/coins.ts, same atomicity/idempotency guarantees
 * as every other coin movement on the platform). Per-impression/click CPM
 * spend then draws down `ad_campaigns.spent_credits` against that pre-paid
 * budget (lib/ads/serve.ts) — this avoids writing one coin_ledger row per
 * ad impression, which would make the ledger table balloon under normal
 * traffic; the campaign's own ad_events log is the impression-level audit
 * trail instead.
 */

import Decimal from "decimal.js";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { classifyAdCreative } from "@/lib/moderation/aiClassifier";
import { getAdModerationMode, getAdAiAutoApproveThreshold, getDefaultCpmCredits } from "@/lib/ads/limits";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdCampaignObjective = "awareness" | "traffic" | "boost_post" | "boost_room";
export type AdCampaignStatus = "draft" | "pending_review" | "approved" | "rejected" | "active" | "paused" | "completed" | "stopped";
export type AdCreativeFormat = "html" | "text" | "image" | "native" | "third_party";
export type AdSize = "300x250" | "320x50" | "interstitial" | "rewarded" | "native";

export interface AdCampaignRow {
  id: string;
  owner_type: "business" | "admin";
  business_account_id: string | null;
  business_page_id: string | null;
  created_by: string;
  name: string;
  objective: AdCampaignObjective;
  status: AdCampaignStatus;
  moderation_status: "pending" | "approved" | "rejected";
  moderation_reason: string | null;
  cpm_credits: string;
  daily_budget_credits: string | null;
  total_budget_credits: string;
  spent_credits: string;
  target_plans: string[] | null;
  frequency_cap_per_user_per_day: number;
  boosted_content_type: string | null;
  boosted_content_id: string | null;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdCreativeRow {
  id: string;
  campaign_id: string;
  placement_key: string;
  format: AdCreativeFormat;
  size: AdSize;
  title: string | null;
  body: string | null;
  image_url: string | null;
  click_url: string | null;
  third_party_tag: string | null;
  cta_label: string | null;
  is_active: boolean;
  impressions_count: number;
  clicks_count: number;
  created_at: string;
}

export interface CreateCampaignInput {
  businessAccountId: string;
  businessPageId: string | null;
  createdBy: string;
  name: string;
  objective: AdCampaignObjective;
  targetPlans?: string[] | null;
  boostedContentType?: "blog_post" | "room" | null;
  boostedContentId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function createCampaign(input: CreateCampaignInput): Promise<AdCampaignRow> {
  const cpm = await getDefaultCpmCredits();
  const { rows } = await db.query<AdCampaignRow>(
    `INSERT INTO ad_campaigns
       (owner_type, business_account_id, business_page_id, created_by, name, objective,
        status, moderation_status, cpm_credits, target_plans, boosted_content_type,
        boosted_content_id, start_at, end_at)
     VALUES ('business', $1, $2, $3, $4, $5, 'draft', 'pending', $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.businessAccountId,
      input.businessPageId,
      input.createdBy,
      input.name,
      input.objective,
      cpm,
      input.targetPlans ?? null,
      input.boostedContentType ?? null,
      input.boostedContentId ?? null,
      input.startAt ?? null,
      input.endAt ?? null,
    ]
  );
  return rows[0];
}

export async function getOwnCampaign(campaignId: string, businessAccountId: string): Promise<AdCampaignRow | null> {
  const { rows } = await db.query<AdCampaignRow>(
    `SELECT * FROM ad_campaigns WHERE id = $1 AND business_account_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [campaignId, businessAccountId]
  );
  return rows[0] ?? null;
}

export async function listOwnCampaigns(businessAccountId: string): Promise<AdCampaignRow[]> {
  const { rows } = await db.query<AdCampaignRow>(
    `SELECT * FROM ad_campaigns WHERE business_account_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [businessAccountId]
  );
  return rows;
}

export async function addCreative(
  campaignId: string,
  input: { placementKey: string; format: AdCreativeFormat; size: AdSize; title?: string; body?: string; imageUrl?: string; clickUrl?: string; ctaLabel?: string }
): Promise<AdCreativeRow> {
  const { rows } = await db.query<AdCreativeRow>(
    `INSERT INTO ad_creatives (campaign_id, placement_key, format, size, title, body, image_url, click_url, cta_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      campaignId,
      input.placementKey,
      input.format,
      input.size,
      input.title ?? null,
      input.body ?? null,
      input.imageUrl ?? null,
      input.clickUrl ?? null,
      input.ctaLabel ?? null,
    ]
  );
  return rows[0];
}

export async function listCreatives(campaignId: string): Promise<AdCreativeRow[]> {
  const { rows } = await db.query<AdCreativeRow>(
    `SELECT * FROM ad_creatives WHERE campaign_id = $1 ORDER BY created_at ASC`,
    [campaignId]
  );
  return rows;
}

/**
 * Submit a draft campaign for moderation. Mirrors the Sponsored Quest
 * self-service moderation flow (lib/business/limits.ts +
 * app/api/business/sponsored-quests/route.ts): manual admin queue by
 * default, or AI auto-approval when x_manifest `ad_moderation_mode` is "ai".
 */
export async function submitCampaignForModeration(
  campaign: AdCampaignRow,
  advertiserName: string
): Promise<{ moderationStatus: "pending" | "approved"; reason: string | null }> {
  const { rows: creativeRows } = await db.query<{ title: string | null; body: string | null; click_url: string | null }>(
    `SELECT title, body, click_url FROM ad_creatives WHERE campaign_id = $1 LIMIT 1`,
    [campaign.id]
  );
  const creative = creativeRows[0];
  const mode = await getAdModerationMode();
  let moderationStatus: "pending" | "approved" = "pending";
  let reason: string | null = null;

  if (mode === "ai") {
    const review = await classifyAdCreative(
      advertiserName,
      campaign.name,
      creative?.title ?? "",
      creative?.body ?? "",
      creative?.click_url ?? ""
    );
    const threshold = await getAdAiAutoApproveThreshold();
    if (review.approvalConfidence >= threshold) moderationStatus = "approved";
    reason = review.reason;
  }

  await db.query(
    `UPDATE ad_campaigns
     SET status = 'pending_review', moderation_status = $1, moderation_mode = $2, moderation_reason = $3, updated_at = NOW()
     WHERE id = $4`,
    [moderationStatus, mode, reason, campaign.id]
  );

  if (moderationStatus === "approved") {
    await db.query(`UPDATE ad_campaigns SET status = 'approved', moderated_at = NOW() WHERE id = $1`, [campaign.id]);
  }

  return { moderationStatus, reason };
}

/** Admin approve/reject of a pending campaign (POST /api/admin/ads/campaigns/:id/moderate). */
export async function moderateCampaign(
  campaignId: string,
  approve: boolean,
  adminId: string,
  reason: string | null
): Promise<void> {
  await db.query(
    `UPDATE ad_campaigns
     SET moderation_status = $1, status = $2, moderation_reason = $3, moderated_by = $4, moderated_at = NOW(), updated_at = NOW()
     WHERE id = $5`,
    [approve ? "approved" : "rejected", approve ? "approved" : "rejected", reason, adminId, campaignId]
  );
}

/** Advertiser starts/pauses/stops a campaign that has already cleared moderation. */
export async function setCampaignRunState(
  campaignId: string,
  businessAccountId: string,
  state: "active" | "paused" | "stopped"
): Promise<AdCampaignRow | null> {
  const { rows } = await db.query<AdCampaignRow>(
    `UPDATE ad_campaigns
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND business_account_id = $3 AND moderation_status = 'approved' AND deleted_at IS NULL
     RETURNING *`,
    [state, campaignId, businessAccountId]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Budget funding (Credits — cash/Play-Billing top-ups land here via the
// existing coin purchase flow, then get moved into a campaign's budget)
// ---------------------------------------------------------------------------

export async function fundCampaign(
  userId: string,
  campaignId: string,
  businessAccountId: string,
  amountCredits: number,
  idempotencyRef: string
): Promise<AdCampaignRow> {
  const amount = new Decimal(amountCredits);
  if (!amount.isInteger() || amount.lte(0)) {
    throw new Error("[ads] fundCampaign: amountCredits must be a positive integer");
  }

  return db.transaction(async (tx: TransactionClient) => {
    const { rows } = await tx.query<AdCampaignRow>(
      `SELECT * FROM ad_campaigns WHERE id = $1 AND business_account_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [campaignId, businessAccountId]
    );
    const campaign = rows[0];
    if (!campaign) throw new Error("Campaign not found");

    await debitCoins(
      userId,
      amount.toNumber(),
      "ad_campaign_funding",
      idempotencyRef,
      `Fund ad campaign "${campaign.name}"`,
      { campaignId },
      tx
    );

    const { rows: updated } = await tx.query<AdCampaignRow>(
      `UPDATE ad_campaigns SET total_budget_credits = total_budget_credits + $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [amount.toFixed(0), campaignId]
    );
    return updated[0];
  });
}

/** Refund any unspent budget back to the advertiser when a campaign is stopped/deleted. */
export async function refundUnspentBudget(
  userId: string,
  campaignId: string,
  businessAccountId: string
): Promise<number> {
  return db.transaction(async (tx: TransactionClient) => {
    const { rows } = await tx.query<AdCampaignRow>(
      `SELECT * FROM ad_campaigns WHERE id = $1 AND business_account_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [campaignId, businessAccountId]
    );
    const campaign = rows[0];
    if (!campaign) throw new Error("Campaign not found");

    const remaining = new Decimal(campaign.total_budget_credits).minus(campaign.spent_credits);
    if (remaining.lte(0)) return 0;

    await creditCoins(
      userId,
      remaining.toNumber(),
      "ad_campaign_refund",
      `${campaignId}:refund`,
      `Unspent budget refund — "${campaign.name}"`,
      { campaignId },
      tx
    );
    await tx.query(
      `UPDATE ad_campaigns SET total_budget_credits = spent_credits, status = 'stopped', updated_at = NOW() WHERE id = $1`,
      [campaignId]
    );
    return remaining.toNumber();
  });
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export interface AdCouponRow {
  id: string;
  code: string;
  discount_type: "percent" | "flat_credits" | "free_credits";
  discount_value: string;
  max_redemptions: number | null;
  redemptions_count: number;
  min_budget_credits: string;
  expires_at: string | null;
  is_active: boolean;
}

export async function redeemCoupon(
  userId: string,
  campaignId: string,
  businessAccountId: string,
  code: string
): Promise<{ creditsApplied: number }> {
  return db.transaction(async (tx: TransactionClient) => {
    const { rows: couponRows } = await tx.query<AdCouponRow>(
      `SELECT * FROM ad_coupons WHERE code = $1 AND is_active = true FOR UPDATE`,
      [code.trim().toUpperCase()]
    );
    const coupon = couponRows[0];
    if (!coupon) throw new Error("Invalid or inactive coupon code");
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw new Error("Coupon has expired");
    if (coupon.max_redemptions != null && coupon.redemptions_count >= coupon.max_redemptions) {
      throw new Error("Coupon redemption limit reached");
    }

    const { rows: campaignRows } = await tx.query<AdCampaignRow>(
      `SELECT * FROM ad_campaigns WHERE id = $1 AND business_account_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [campaignId, businessAccountId]
    );
    const campaign = campaignRows[0];
    if (!campaign) throw new Error("Campaign not found");

    if (new Decimal(campaign.total_budget_credits).lt(coupon.min_budget_credits)) {
      throw new Error(`This coupon requires a budget of at least ${coupon.min_budget_credits} Credits`);
    }

    let creditsApplied: Decimal;
    if (coupon.discount_type === "percent") {
      creditsApplied = new Decimal(campaign.total_budget_credits).times(coupon.discount_value).dividedBy(100).floor();
    } else {
      creditsApplied = new Decimal(coupon.discount_value);
    }
    if (creditsApplied.lte(0)) throw new Error("Coupon has no effect on this campaign");

    // Idempotent per (coupon, campaign) via the unique constraint — a retried
    // redemption attempt fails cleanly instead of double-crediting the budget.
    await tx.query(
      `INSERT INTO ad_coupon_redemptions (coupon_id, campaign_id, user_id, credits_applied)
       VALUES ($1,$2,$3,$4)`,
      [coupon.id, campaignId, userId, creditsApplied.toFixed(0)]
    );

    await tx.query(`UPDATE ad_coupons SET redemptions_count = redemptions_count + 1 WHERE id = $1`, [coupon.id]);
    await tx.query(
      `UPDATE ad_campaigns SET total_budget_credits = total_budget_credits + $1, updated_at = NOW() WHERE id = $2`,
      [creditsApplied.toFixed(0), campaignId]
    );

    return { creditsApplied: creditsApplied.toNumber() };
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface AdDailyStatRow {
  date: string;
  impressions: number;
  clicks: number;
  spend_credits: string;
}

export async function getCampaignDailyStats(campaignId: string, days: number): Promise<AdDailyStatRow[]> {
  const { rows } = await db.query<AdDailyStatRow>(
    `SELECT date, impressions, clicks, spend_credits FROM ad_campaign_daily_stats
     WHERE campaign_id = $1 AND date >= (CURRENT_DATE - $2::int)
     ORDER BY date ASC`,
    [campaignId, days]
  );
  return rows;
}

export async function getCampaignTotals(businessAccountId: string): Promise<{ impressions: number; clicks: number; spend_credits: string }> {
  const { rows } = await db.query<{ impressions: string; clicks: string; spend_credits: string }>(
    `SELECT COALESCE(SUM(s.impressions),0)::text AS impressions,
            COALESCE(SUM(s.clicks),0)::text AS clicks,
            COALESCE(SUM(c.spent_credits),0)::text AS spend_credits
     FROM ad_campaigns c
     LEFT JOIN ad_campaign_daily_stats s ON s.campaign_id = c.id
     WHERE c.business_account_id = $1 AND c.deleted_at IS NULL`,
    [businessAccountId]
  );
  const r = rows[0];
  return { impressions: Number(r?.impressions ?? 0), clicks: Number(r?.clicks ?? 0), spend_credits: r?.spend_credits ?? "0" };
}
