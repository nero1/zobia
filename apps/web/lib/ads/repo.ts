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
import { debitAdWallet, creditAdWallet } from "@/lib/economy/adWallet";
import { classifyAdCreative, classifyAdCreativeImage } from "@/lib/moderation/aiClassifier";
import { getAdModerationModeFor, getAdAiAutoApproveThreshold, getDefaultCpmCredits, getAdsAdminConfig } from "@/lib/ads/limits";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdCampaignObjective = "awareness" | "traffic" | "boost_post" | "boost_room" | "boost_content";
/**
 * Every boostable content type on the platform. A "boost" is simply an
 * ad_campaigns row with objective='boost_content' (or the legacy
 * 'boost_post'/'boost_room') and boosted_content_type as the discriminator —
 * no separate boost table. See createContentBoostCampaign() below.
 */
export type BoostableContentType =
  | "moment"
  | "tweet"
  | "blog_post"
  | "forum_thread"
  | "forum_question"
  | "room"
  | "wiki_page"
  | "game"
  | "classroom"
  | "business_page_post";
export type AdCampaignStatus = "draft" | "pending_review" | "approved" | "rejected" | "active" | "paused" | "completed" | "stopped";
export type AdCreativeFormat = "html" | "text" | "image" | "native" | "third_party";
export type AdSize = "300x250" | "320x50" | "interstitial" | "rewarded" | "native";

export type AdvertiserType = "personal" | "business_account" | "business_page";

export interface AdCampaignRow {
  id: string;
  owner_type: "business" | "admin";
  business_account_id: string | null;
  business_page_id: string | null;
  created_by: string;
  advertiser_type: AdvertiserType;
  advertiser_user_id: string | null;
  advertiser_grace_until: string | null;
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
  /** Null for a personal-advertiser campaign (no Business Account). */
  businessAccountId: string | null;
  businessPageId: string | null;
  createdBy: string;
  /** Which identity is shown to viewers as the advertiser. */
  advertiserType: AdvertiserType;
  name: string;
  objective: AdCampaignObjective;
  targetPlans?: string[] | null;
  boostedContentType?: BoostableContentType | null;
  boostedContentId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function createCampaign(input: CreateCampaignInput): Promise<AdCampaignRow> {
  const cpm = await getDefaultCpmCredits();
  const advertiserUserId = input.advertiserType === "personal" ? input.createdBy : null;
  const { rows } = await db.query<AdCampaignRow>(
    `INSERT INTO ad_campaigns
       (owner_type, business_account_id, business_page_id, created_by, advertiser_type,
        advertiser_user_id, name, objective, status, moderation_status, cpm_credits,
        target_plans, boosted_content_type, boosted_content_id, start_at, end_at)
     VALUES ('business', $1, $2, $3, $4, $5, $6, $7, 'draft', 'pending', $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.businessAccountId,
      input.businessPageId,
      input.createdBy,
      input.advertiserType,
      advertiserUserId,
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

// ---------------------------------------------------------------------------
// Generic content boost — "the boosts feature is under ads: a sponsored post
// ad type where a user can boost any content type that is boostable" (product
// decision). Reuses ad_campaigns/ad_creatives/submitCampaignForModeration/
// moderateCampaign exactly as they exist — same moderation queue, same CPM
// billing via lib/economy/adWallet.ts, same admin approval at /gate44/ads.
// ---------------------------------------------------------------------------

interface BoostableContentSummary {
  /** The row's author/owner user id, for ownership checks by the caller. */
  ownerId: string | null;
  title: string;
  body: string | null;
  imageUrl: string | null;
}

/**
 * Look up the minimal fields (owner, title, body/excerpt, image) needed to
 * auto-fill a content-boost ad_creative, per content type. Column names vary
 * across content tables (some Drizzle-typed, bbforum is raw SQL) — see the
 * per-type schema notes in lib/db/schema.ts and lib/bbforum/repo.ts.
 *
 * Returns null if the content row does not exist (caller should 404).
 */
export async function getBoostableContentSummary(
  contentType: BoostableContentType,
  contentId: string
): Promise<BoostableContentSummary | null> {
  switch (contentType) {
    case "moment": {
      const { rows } = await db.query<{ user_id: string; content: string; media_url: string | null }>(
        `SELECT user_id, content, media_url FROM moments WHERE id = $1 LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.user_id, title: "Moment", body: r.content, imageUrl: r.media_url };
    }
    case "tweet": {
      const { rows } = await db.query<{ user_id: string; content: string | null; image_url: string | null }>(
        `SELECT user_id, content, image_url FROM tweets WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.user_id, title: "Tweet", body: r.content, imageUrl: r.image_url };
    }
    case "blog_post": {
      const { rows } = await db.query<{ author_id: string; title: string; excerpt: string | null; featured_image_url: string | null }>(
        `SELECT author_id, title, excerpt, featured_image_url FROM blog_posts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.author_id, title: r.title, body: r.excerpt, imageUrl: r.featured_image_url };
    }
    case "forum_thread": {
      // bb_threads — raw-SQL table (migration 0001_consolidated_schema.sql), not in schema.ts.
      const { rows } = await db.query<{ author_id: string; title: string }>(
        `SELECT author_id, title FROM bb_threads WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.author_id, title: r.title, body: null, imageUrl: null };
    }
    case "forum_question": {
      const { rows } = await db.query<{ author_id: string; title: string; body: string }>(
        `SELECT author_id, title, body FROM forum_questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.author_id, title: r.title, body: r.body, imageUrl: null };
    }
    case "room":
    case "classroom": {
      const { rows } = await db.query<{ creator_id: string; name: string; description: string | null; cover_image_url: string | null }>(
        `SELECT creator_id, name, description, cover_image_url FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.creator_id, title: r.name, body: r.description, imageUrl: r.cover_image_url };
    }
    case "wiki_page": {
      const { rows } = await db.query<{ created_by: string; title: string }>(
        `SELECT created_by, title FROM wiki_pages WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.created_by, title: r.title, body: null, imageUrl: null };
    }
    case "game": {
      const { rows } = await db.query<{ creator_id: string | null; name: string; description: string | null; cover_image_url: string | null }>(
        `SELECT creator_id, name, description, cover_image_url FROM games WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.creator_id, title: r.name, body: r.description, imageUrl: r.cover_image_url };
    }
    case "business_page_post": {
      const { rows } = await db.query<{ owner_id: string; title: string; body: string; image_url: string | null }>(
        `SELECT ba.user_id AS owner_id, p.title, p.body, p.image_url
         FROM business_page_posts p
         JOIN business_pages bp ON bp.id = p.page_id
         JOIN business_accounts ba ON ba.id = bp.business_account_id
         WHERE p.id = $1 AND p.deleted_at IS NULL LIMIT 1`,
        [contentId]
      );
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.owner_id, title: r.title, body: r.body, imageUrl: r.image_url };
    }
    default:
      return null;
  }
}

export interface CreateContentBoostCampaignInput {
  createdBy: string;
  businessAccountId: string | null;
  businessPageId: string | null;
  advertiserType: AdvertiserType;
  boostedContentType: BoostableContentType;
  boostedContentId: string;
  targetPlans?: string[] | null;
  startAt?: string | null;
  endAt?: string | null;
  clickUrl: string;
  /**
   * Admin/mod-authored boosts are "in-house boosted" per the Home Feed
   * ranking algorithm (lib/feed/ranking.ts tier 5) rather than tier-1
   * "boosted content" — the caller (app/api/content/boost) determines this
   * from the content owner's role and stores it as campaign metadata via
   * the campaign name for now (no dedicated column — see ranking.ts for the
   * documented simplification: in-house detection re-derives this from the
   * content author's is_admin/is_moderator flag at read time instead).
   */
  isInHouse?: boolean;
}

/**
 * Create a draft ad_campaigns row + matching ad_creatives row for a single
 * piece of boostable content in one call — wraps createCampaign() + addCreative(),
 * auto-filling the creative's title/body/image from the content row. Caller
 * is responsible for ownership/eligibility checks and for calling
 * submitCampaignForModeration() afterwards (mirrors the two-step self-service
 * flow every other campaign type already uses).
 */
export async function createContentBoostCampaign(
  input: CreateContentBoostCampaignInput
): Promise<{ campaign: AdCampaignRow; creative: AdCreativeRow } | null> {
  const content = await getBoostableContentSummary(input.boostedContentType, input.boostedContentId);
  if (!content) return null;

  const campaign = await createCampaign({
    businessAccountId: input.businessAccountId,
    businessPageId: input.businessPageId,
    createdBy: input.createdBy,
    advertiserType: input.advertiserType,
    name: `Boost: ${content.title}`.slice(0, 150),
    objective: "boost_content",
    targetPlans: input.targetPlans ?? null,
    boostedContentType: input.boostedContentType,
    boostedContentId: input.boostedContentId,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
  });

  const creative = await addCreative(campaign.id, {
    placementKey: "content_boost",
    format: "native",
    size: "native",
    title: content.title,
    body: content.body ?? undefined,
    imageUrl: content.imageUrl ?? undefined,
    clickUrl: input.clickUrl,
  });

  return { campaign, creative };
}

/**
 * Ownership is always by `created_by` (the authenticated user who submitted
 * the campaign) — not by business_account_id, which is null for a
 * personal-advertiser campaign. business_account_id/business_page_id are
 * purely "which identity is displayed", never "who controls this campaign".
 */
export async function getOwnCampaign(campaignId: string, userId: string): Promise<AdCampaignRow | null> {
  const { rows } = await db.query<AdCampaignRow>(
    `SELECT * FROM ad_campaigns WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL LIMIT 1`,
    [campaignId, userId]
  );
  return rows[0] ?? null;
}

export async function listOwnCampaigns(userId: string): Promise<AdCampaignRow[]> {
  const { rows } = await db.query<AdCampaignRow>(
    `SELECT * FROM ad_campaigns WHERE created_by = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [userId]
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
 * default, or AI auto-approval when the admin has turned it on for this
 * creative's type (`ad_moderation_mode_text` / `ad_moderation_mode_image`
 * — see lib/ads/limits.ts getAdModerationModeFor). Image creatives are
 * always routed to an image-capable model (classifyAdCreativeImage),
 * never the text classifier — a text model cannot see the image.
 */
export async function submitCampaignForModeration(
  campaign: AdCampaignRow,
  advertiserName: string
): Promise<{ moderationStatus: "pending" | "approved"; reason: string | null }> {
  const { rows: creativeRows } = await db.query<{ title: string | null; body: string | null; click_url: string | null; format: string; image_url: string | null }>(
    `SELECT title, body, click_url, format, image_url FROM ad_creatives WHERE campaign_id = $1 LIMIT 1`,
    [campaign.id]
  );
  const creative = creativeRows[0];
  const isImageCreative = creative?.format === "image" && !!creative.image_url;
  const mode = await getAdModerationModeFor(isImageCreative ? "image" : "text");
  let moderationStatus: "pending" | "approved" = "pending";
  let reason: string | null = null;

  if (mode === "ai") {
    const review = isImageCreative
      ? await classifyAdCreativeImage(creative!.image_url!)
      : await classifyAdCreative(
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
  userId: string,
  state: "active" | "paused" | "stopped"
): Promise<AdCampaignRow | null> {
  const { rows } = await db.query<AdCampaignRow>(
    `UPDATE ad_campaigns
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND created_by = $3 AND moderation_status = 'approved' AND deleted_at IS NULL
     RETURNING *`,
    [state, campaignId, userId]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Budget funding — draws from the advertiser's Ad Wallet (lib/economy/adWallet.ts),
// a distinct prepaid balance from coin_balance. The Ad Wallet itself is funded
// either by transfer from coin_balance or by direct purchase (see
// app/api/business/ads/wallet/* routes) — see that module's header comment.
// ---------------------------------------------------------------------------

export async function fundCampaign(
  userId: string,
  campaignId: string,
  amountCredits: number,
  idempotencyRef: string
): Promise<AdCampaignRow> {
  const amount = new Decimal(amountCredits);
  if (!amount.isInteger() || amount.lte(0)) {
    throw new Error("[ads] fundCampaign: amountCredits must be a positive integer");
  }

  return db.transaction(async (tx: TransactionClient) => {
    const { rows } = await tx.query<AdCampaignRow>(
      `SELECT * FROM ad_campaigns WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL FOR UPDATE`,
      [campaignId, userId]
    );
    const campaign = rows[0];
    if (!campaign) throw new Error("Campaign not found");

    await debitAdWallet(
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

/** Refund any unspent budget back to the advertiser's Ad Wallet when a campaign is stopped/deleted. */
export async function refundUnspentBudget(
  userId: string,
  campaignId: string
): Promise<number> {
  return db.transaction(async (tx: TransactionClient) => {
    const { rows } = await tx.query<AdCampaignRow>(
      `SELECT * FROM ad_campaigns WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL FOR UPDATE`,
      [campaignId, userId]
    );
    const campaign = rows[0];
    if (!campaign) throw new Error("Campaign not found");

    const remaining = new Decimal(campaign.total_budget_credits).minus(campaign.spent_credits);
    if (remaining.lte(0)) return 0;

    await creditAdWallet(
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
// Advertiser grace period — when a business_account/business_page campaign's
// underlying subscription lapses (status leaves 'active' or verification is
// pulled), its currently-running ads keep serving under the original
// advertiser identity for `ad_advertiser_grace_days` (default 14) instead of
// stopping immediately. Called from the same daily sweep as the business
// downgrade sweep (lib/business/downgradeSweep.ts).
// ---------------------------------------------------------------------------

/**
 * Stamp `advertiser_grace_until` on any actively-serving business/page
 * campaign whose business account is no longer active+verified and doesn't
 * already have a grace deadline set. Idempotent — only touches rows where
 * advertiser_grace_until IS NULL, so a re-run never extends the window.
 */
export async function stampLapsedAdvertiserGrace(): Promise<number> {
  const graceDays = (await getAdsAdminConfig()).advertiserGraceDays;
  const { rowCount } = await db.query(
    `UPDATE ad_campaigns c
     SET advertiser_grace_until = NOW() + ($1 || ' days')::interval, updated_at = NOW()
     FROM business_accounts ba
     WHERE c.business_account_id = ba.id
       AND c.advertiser_type IN ('business_account', 'business_page')
       AND c.status IN ('active', 'paused')
       AND c.deleted_at IS NULL
       AND c.advertiser_grace_until IS NULL
       AND NOT (ba.status = 'active' AND ba.verified = true)`,
    [graceDays]
  );
  return rowCount ?? 0;
}

/** Stop any campaign whose advertiser grace period has expired. */
export async function stopExpiredGraceCampaigns(): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE ad_campaigns
     SET status = 'stopped', updated_at = NOW()
     WHERE advertiser_grace_until IS NOT NULL
       AND advertiser_grace_until < NOW()
       AND status IN ('active', 'paused')
       AND deleted_at IS NULL`
  );
  return rowCount ?? 0;
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
      `SELECT * FROM ad_campaigns WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL FOR UPDATE`,
      [campaignId, userId]
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

export async function getCampaignTotals(userId: string): Promise<{ impressions: number; clicks: number; spend_credits: string }> {
  const { rows } = await db.query<{ impressions: string; clicks: string; spend_credits: string }>(
    `SELECT COALESCE(SUM(s.impressions),0)::text AS impressions,
            COALESCE(SUM(s.clicks),0)::text AS clicks,
            COALESCE(SUM(c.spent_credits),0)::text AS spend_credits
     FROM ad_campaigns c
     LEFT JOIN ad_campaign_daily_stats s ON s.campaign_id = c.id
     WHERE c.created_by = $1 AND c.deleted_at IS NULL`,
    [userId]
  );
  const r = rows[0];
  return { impressions: Number(r?.impressions ?? 0), clicks: Number(r?.clicks ?? 0), spend_credits: r?.spend_credits ?? "0" };
}
