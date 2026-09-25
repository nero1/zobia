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
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { debitAdWallet, creditAdWallet } from "@/lib/economy/adWallet";
import { classifyAdCreative, classifyAdCreativeImage } from "@/lib/moderation/aiClassifier";
import { getAdModerationModeFor, getAdAiAutoApproveThreshold, getDefaultCpmCredits, getAdsAdminConfig } from "@/lib/ads/limits";
import { raiseAlert } from "@/lib/alerts/dispatch";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// NOTE (schema gap): ad_ai_escalations has no corresponding pgTable in
// lib/db/schema.ts. ad_campaigns, ad_creatives, ad_coupons,
// ad_coupon_redemptions and ad_campaign_daily_stats WERE missing too but have
// since been added — most queries against those tables in this file still
// run through Drizzle's `sql` tagged template via `.execute()` rather than
// the query builder for now (still the shared Drizzle-wrapped pg.Pool, still
// fully parameterised); a follow-up can swap them to the fluent builder.
// bb_threads was already raw-SQL/unmodeled before this migration (see
// getBoostableContentSummary's "forum_thread" case) and remains so.
// ---------------------------------------------------------------------------

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
  | "business_page_post"
  | "poll"
  | "quiz";
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
  ai_confidence: string | null;
  ai_escalated: boolean;
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
  const orm = await getDb();
  const result = await orm.execute<AdCampaignRow & Record<string, unknown>>(sql`
    INSERT INTO ad_campaigns
       (owner_type, business_account_id, business_page_id, created_by, advertiser_type,
        advertiser_user_id, name, objective, status, moderation_status, cpm_credits,
        target_plans, boosted_content_type, boosted_content_id, start_at, end_at)
     VALUES ('business', ${input.businessAccountId}, ${input.businessPageId}, ${input.createdBy}, ${input.advertiserType}, ${advertiserUserId}, ${input.name}, ${input.objective}, 'draft', 'pending', ${cpm}, ${input.targetPlans ?? null}, ${input.boostedContentType ?? null}, ${input.boostedContentId ?? null}, ${input.startAt ?? null}, ${input.endAt ?? null})
     RETURNING *
  `);
  return result.rows[0];
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
  const orm = await getDb();
  switch (contentType) {
    case "moment": {
      const rows = await orm
        .select({ user_id: schema.moments.userId, content: schema.moments.content, media_url: schema.moments.mediaUrl })
        .from(schema.moments)
        .where(eq(schema.moments.id, contentId))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.user_id, title: "Moment", body: r.content, imageUrl: r.media_url };
    }
    case "tweet": {
      const rows = await orm
        .select({ user_id: schema.tweets.userId, content: schema.tweets.content, image_url: schema.tweets.imageUrl })
        .from(schema.tweets)
        .where(and(eq(schema.tweets.id, contentId), sql`${schema.tweets.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.user_id, title: "Tweet", body: r.content, imageUrl: r.image_url };
    }
    case "blog_post": {
      const rows = await orm
        .select({ author_id: schema.blogPosts.authorId, title: schema.blogPosts.title, excerpt: schema.blogPosts.excerpt, featured_image_url: schema.blogPosts.featuredImageUrl })
        .from(schema.blogPosts)
        .where(and(eq(schema.blogPosts.id, contentId), sql`${schema.blogPosts.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.author_id, title: r.title, body: r.excerpt, imageUrl: r.featured_image_url };
    }
    case "forum_thread": {
      // bb_threads — raw-SQL table (migration 0001_consolidated_schema.sql), not in schema.ts.
      const result = await orm.execute<{ author_id: string; title: string }>(
        sql`SELECT author_id, title FROM bb_threads WHERE id = ${contentId} AND deleted_at IS NULL LIMIT 1`
      );
      const r = result.rows[0];
      if (!r) return null;
      return { ownerId: r.author_id, title: r.title, body: null, imageUrl: null };
    }
    case "forum_question": {
      const rows = await orm
        .select({ author_id: schema.forumQuestions.authorId, title: schema.forumQuestions.title, body: schema.forumQuestions.body })
        .from(schema.forumQuestions)
        .where(and(eq(schema.forumQuestions.id, contentId), sql`${schema.forumQuestions.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.author_id, title: r.title, body: r.body, imageUrl: null };
    }
    case "room":
    case "classroom": {
      const rows = await orm
        .select({ creator_id: schema.rooms.creatorId, name: schema.rooms.name, description: schema.rooms.description, cover_image_url: schema.rooms.coverImageUrl })
        .from(schema.rooms)
        .where(and(eq(schema.rooms.id, contentId), sql`${schema.rooms.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.creator_id, title: r.name, body: r.description, imageUrl: r.cover_image_url };
    }
    case "wiki_page": {
      const rows = await orm
        .select({ created_by: schema.wikiPages.createdBy, title: schema.wikiPages.title })
        .from(schema.wikiPages)
        .where(and(eq(schema.wikiPages.id, contentId), sql`${schema.wikiPages.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.created_by, title: r.title, body: null, imageUrl: null };
    }
    case "game": {
      const rows = await orm
        .select({ creator_id: schema.games.creatorId, name: schema.games.name, description: schema.games.description, cover_image_url: schema.games.coverImageUrl })
        .from(schema.games)
        .where(and(eq(schema.games.id, contentId), sql`${schema.games.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.creator_id, title: r.name, body: r.description, imageUrl: r.cover_image_url };
    }
    case "business_page_post": {
      const rows = await orm
        .select({ owner_id: schema.businessAccounts.userId, title: schema.businessPagePosts.title, body: schema.businessPagePosts.body, image_url: schema.businessPagePosts.imageUrl })
        .from(schema.businessPagePosts)
        .innerJoin(schema.businessPages, eq(schema.businessPages.id, schema.businessPagePosts.pageId))
        .innerJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.businessPages.businessAccountId))
        .where(and(eq(schema.businessPagePosts.id, contentId), sql`${schema.businessPagePosts.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.owner_id, title: r.title, body: r.body, imageUrl: r.image_url };
    }
    case "poll": {
      const rows = await orm
        .select({ creator_id: schema.polls.creatorId, title: schema.polls.title, description: schema.polls.description })
        .from(schema.polls)
        .where(and(eq(schema.polls.id, contentId), sql`${schema.polls.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.creator_id, title: r.title, body: r.description, imageUrl: null };
    }
    case "quiz": {
      const rows = await orm
        .select({ creator_id: schema.quizzes.creatorId, title: schema.quizzes.title, description: schema.quizzes.description })
        .from(schema.quizzes)
        .where(and(eq(schema.quizzes.id, contentId), sql`${schema.quizzes.deletedAt} IS NULL`))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { ownerId: r.creator_id, title: r.title, body: r.description, imageUrl: null };
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
  const orm = await getDb();
  const result = await orm.execute<AdCampaignRow & Record<string, unknown>>(
    sql`SELECT * FROM ad_campaigns WHERE id = ${campaignId} AND created_by = ${userId} AND deleted_at IS NULL LIMIT 1`
  );
  return result.rows[0] ?? null;
}

export async function listOwnCampaigns(userId: string): Promise<AdCampaignRow[]> {
  const orm = await getDb();
  const result = await orm.execute<AdCampaignRow & Record<string, unknown>>(
    sql`SELECT * FROM ad_campaigns WHERE created_by = ${userId} AND deleted_at IS NULL ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function addCreative(
  campaignId: string,
  input: { placementKey: string; format: AdCreativeFormat; size: AdSize; title?: string; body?: string; imageUrl?: string; clickUrl?: string; ctaLabel?: string }
): Promise<AdCreativeRow> {
  const orm = await getDb();
  const result = await orm.execute<AdCreativeRow & Record<string, unknown>>(sql`
    INSERT INTO ad_creatives (campaign_id, placement_key, format, size, title, body, image_url, click_url, cta_label)
     VALUES (${campaignId},${input.placementKey},${input.format},${input.size},${input.title ?? null},${input.body ?? null},${input.imageUrl ?? null},${input.clickUrl ?? null},${input.ctaLabel ?? null})
     RETURNING *
  `);
  return result.rows[0];
}

export async function listCreatives(campaignId: string): Promise<AdCreativeRow[]> {
  const orm = await getDb();
  const result = await orm.execute<AdCreativeRow & Record<string, unknown>>(
    sql`SELECT * FROM ad_creatives WHERE campaign_id = ${campaignId} ORDER BY created_at ASC`
  );
  return result.rows;
}

/**
 * Submit a draft campaign for moderation. Mirrors the Sponsored Quest
 * self-service moderation flow (lib/business/limits.ts +
 * app/api/business/sponsored-quests/route.ts): manual admin queue by
 * default, or AI auto-approval when the admin has turned it on for this
 * creative's type (`ad_moderation_mode_text` / `ad_moderation_mode_image`
 * — see lib/ads/limits.ts getAdModerationModeFor). Image creatives are
 * always routed to an image-capable model (classifyAdCreativeImage), never
 * the text classifier — a text model cannot see the image.
 *
 * Every creative on the campaign is reviewed (not just the first one) — a
 * campaign is only eligible for auto-approval when ALL of its creatives
 * clear the threshold. If any image creative comes back `needsHumanReview`
 * (both DeepSeek and Gemini were low-confidence or failed), the campaign is
 * flagged `ai_escalated` and a row is written to `ad_ai_escalations` for the
 * Ad Moderator review queue (/gate44/ads/moderation-queue) instead of
 * silently falling through to the generic manual admin queue.
 */
export async function submitCampaignForModeration(
  campaign: AdCampaignRow,
  advertiserName: string
): Promise<{ moderationStatus: "pending" | "approved"; reason: string | null }> {
  const orm = await getDb();
  const creativeResult = await orm.execute<{ id: string; title: string | null; body: string | null; click_url: string | null; format: string; image_url: string | null }>(
    sql`SELECT id, title, body, click_url, format, image_url FROM ad_creatives WHERE campaign_id = ${campaign.id} ORDER BY created_at ASC`
  );
  const creativeRows = creativeResult.rows;

  // No creatives yet (e.g. draft campaign submitted before adding one) —
  // nothing to review; fall back to the manual queue rather than auto-approving.
  if (creativeRows.length === 0) {
    await orm.execute(
      sql`UPDATE ad_campaigns SET status = 'pending_review', moderation_status = 'pending', moderation_mode = 'manual', moderation_reason = 'No creatives submitted yet.', updated_at = NOW() WHERE id = ${campaign.id}`
    );
    return { moderationStatus: "pending", reason: "No creatives submitted yet." };
  }

  const hasImageCreative = creativeRows.some((c) => c.format === "image" && !!c.image_url);
  const mode = await getAdModerationModeFor(hasImageCreative ? "image" : "text");
  let moderationStatus: "pending" | "approved" = "pending";
  let reason: string | null = null;
  let minConfidence: number | null = null;
  let anyNeedsHumanReview = false;
  const escalationInserts: { creativeId: string; imageUrl: string; deepseekResult: unknown; geminiResult: unknown }[] = [];

  if (mode === "ai") {
    const threshold = await getAdAiAutoApproveThreshold();
    let allApproved = true;
    const reasons: string[] = [];

    for (const creative of creativeRows) {
      const isImageCreative = creative.format === "image" && !!creative.image_url;

      if (isImageCreative) {
        const review = await classifyAdCreativeImage(creative.image_url!);
        minConfidence = minConfidence === null ? review.approvalConfidence : Math.min(minConfidence, review.approvalConfidence);
        reasons.push(review.reason);

        if (review.needsHumanReview) {
          anyNeedsHumanReview = true;
          allApproved = false;
          const deepseekAttempt = review.attempts.find((a) => a.provider === "deepseek") ?? null;
          const geminiAttempt = review.attempts.find((a) => a.provider === "gemini") ?? null;
          escalationInserts.push({
            creativeId: creative.id,
            imageUrl: creative.image_url!,
            deepseekResult: deepseekAttempt,
            geminiResult: geminiAttempt,
          });
          continue;
        }

        if (review.approvalConfidence < threshold) allApproved = false;
        continue;
      }

      const review = await classifyAdCreative(advertiserName, campaign.name, creative.title ?? "", creative.body ?? "", creative.click_url ?? "");
      minConfidence = minConfidence === null ? review.approvalConfidence : Math.min(minConfidence, review.approvalConfidence);
      reasons.push(review.reason);

      if (review.approvalConfidence < threshold) allApproved = false;
    }

    if (allApproved) moderationStatus = "approved";
    reason = reasons.join(" | ").slice(0, 500);
  }

  await orm.execute(sql`
    UPDATE ad_campaigns
     SET status = 'pending_review', moderation_status = ${moderationStatus}, moderation_mode = ${mode}, moderation_reason = ${reason},
         ai_confidence = ${minConfidence}, ai_escalated = ${anyNeedsHumanReview}, updated_at = NOW()
     WHERE id = ${campaign.id}
  `);

  if (moderationStatus === "approved") {
    await orm.execute(sql`UPDATE ad_campaigns SET status = 'approved', moderated_at = NOW() WHERE id = ${campaign.id}`);
  }

  for (const insert of escalationInserts) {
    await orm.execute(sql`
      INSERT INTO ad_ai_escalations (campaign_id, creative_id, image_url, deepseek_result, gemini_result)
       VALUES (${campaign.id}, ${insert.creativeId}, ${insert.imageUrl}, ${JSON.stringify(insert.deepseekResult)}, ${JSON.stringify(insert.geminiResult)})
    `);
  }

  if (anyNeedsHumanReview) {
    await raiseAlert(orm, {
      type: "ad_image_ai_escalated",
      category: "moderation",
      priorityLevel: 6,
      title: "Ad image needs human review",
      message: `Advertiser "${advertiserName}"'s ad campaign ("${campaign.name}") has an image neither AI provider could confidently classify — awaiting Ad Moderator review.`,
      metadata: { campaignId: campaign.id, businessAccountId: campaign.business_account_id },
      dedupeKey: `ad_image_ai_escalated:${campaign.id}`,
    }).catch((err) => logger.error({ err }, "[ads/repo] failed to write ad_image_ai_escalated alert"));
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
  const orm = await getDb();
  const status = approve ? "approved" : "rejected";
  await orm.execute(sql`
    UPDATE ad_campaigns
     SET moderation_status = ${status}, status = ${status}, moderation_reason = ${reason}, moderated_by = ${adminId}, moderated_at = NOW(), updated_at = NOW(), ai_escalated = false
     WHERE id = ${campaignId}
  `);
  // A direct admin decision on the whole campaign supersedes any pending
  // per-image AI escalation for it — clear the queue entry so it doesn't
  // linger as "pending" after the campaign itself is already resolved.
  await orm.execute(sql`
    UPDATE ad_ai_escalations SET status = ${status}, reviewed_by = ${adminId}, reviewed_at = NOW(), review_note = 'Resolved via campaign-level moderation decision.'
     WHERE campaign_id = ${campaignId} AND status = 'pending'
  `);
}

/** Advertiser starts/pauses/stops a campaign that has already cleared moderation. */
export async function setCampaignRunState(
  campaignId: string,
  userId: string,
  state: "active" | "paused" | "stopped"
): Promise<AdCampaignRow | null> {
  const orm = await getDb();
  const result = await orm.execute<AdCampaignRow & Record<string, unknown>>(sql`
    UPDATE ad_campaigns
     SET status = ${state}, updated_at = NOW()
     WHERE id = ${campaignId} AND created_by = ${userId} AND moderation_status = 'approved' AND deleted_at IS NULL
     RETURNING *
  `);
  return result.rows[0] ?? null;
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

  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const selectResult = await tx.execute<AdCampaignRow & Record<string, unknown>>(
      sql`SELECT * FROM ad_campaigns WHERE id = ${campaignId} AND created_by = ${userId} AND deleted_at IS NULL FOR UPDATE`
    );
    const campaign = selectResult.rows[0];
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

    const updateResult = await tx.execute<AdCampaignRow & Record<string, unknown>>(
      sql`UPDATE ad_campaigns SET total_budget_credits = total_budget_credits + ${amount.toFixed(0)} , updated_at = NOW() WHERE id = ${campaignId} RETURNING *`
    );
    return updateResult.rows[0];
  });
}

/** Refund any unspent budget back to the advertiser's Ad Wallet when a campaign is stopped/deleted. */
export async function refundUnspentBudget(
  userId: string,
  campaignId: string
): Promise<number> {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const selectResult = await tx.execute<AdCampaignRow & Record<string, unknown>>(
      sql`SELECT * FROM ad_campaigns WHERE id = ${campaignId} AND created_by = ${userId} AND deleted_at IS NULL FOR UPDATE`
    );
    const campaign = selectResult.rows[0];
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
    await tx.execute(
      sql`UPDATE ad_campaigns SET total_budget_credits = spent_credits, status = 'stopped', updated_at = NOW() WHERE id = ${campaignId}`
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
  const orm = await getDb();
  const result = await orm.execute(sql`
    UPDATE ad_campaigns c
     SET advertiser_grace_until = NOW() + (${graceDays} || ' days')::interval, updated_at = NOW()
     FROM business_accounts ba
     WHERE c.business_account_id = ba.id
       AND c.advertiser_type IN ('business_account', 'business_page')
       AND c.status IN ('active', 'paused')
       AND c.deleted_at IS NULL
       AND c.advertiser_grace_until IS NULL
       AND NOT (ba.status = 'active' AND ba.verified = true)
  `);
  return result.rowCount ?? 0;
}

/** Stop any campaign whose advertiser grace period has expired. */
export async function stopExpiredGraceCampaigns(): Promise<number> {
  const orm = await getDb();
  const result = await orm.execute(sql`
    UPDATE ad_campaigns
     SET status = 'stopped', updated_at = NOW()
     WHERE advertiser_grace_until IS NOT NULL
       AND advertiser_grace_until < NOW()
       AND status IN ('active', 'paused')
       AND deleted_at IS NULL
  `);
  return result.rowCount ?? 0;
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
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const couponResult = await tx.execute<AdCouponRow & Record<string, unknown>>(
      sql`SELECT * FROM ad_coupons WHERE code = ${code.trim().toUpperCase()} AND is_active = true FOR UPDATE`
    );
    const coupon = couponResult.rows[0];
    if (!coupon) throw new Error("Invalid or inactive coupon code");
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw new Error("Coupon has expired");
    if (coupon.max_redemptions != null && coupon.redemptions_count >= coupon.max_redemptions) {
      throw new Error("Coupon redemption limit reached");
    }

    const campaignResult = await tx.execute<AdCampaignRow & Record<string, unknown>>(
      sql`SELECT * FROM ad_campaigns WHERE id = ${campaignId} AND created_by = ${userId} AND deleted_at IS NULL FOR UPDATE`
    );
    const campaign = campaignResult.rows[0];
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
    await tx.execute(sql`
      INSERT INTO ad_coupon_redemptions (coupon_id, campaign_id, user_id, credits_applied)
       VALUES (${coupon.id},${campaignId},${userId},${creditsApplied.toFixed(0)})
    `);

    await tx.execute(sql`UPDATE ad_coupons SET redemptions_count = redemptions_count + 1 WHERE id = ${coupon.id}`);
    await tx.execute(sql`
      UPDATE ad_campaigns SET total_budget_credits = total_budget_credits + ${creditsApplied.toFixed(0)}, updated_at = NOW() WHERE id = ${campaignId}
    `);

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
  const orm = await getDb();
  const result = await orm.execute<AdDailyStatRow & Record<string, unknown>>(sql`
    SELECT date, impressions, clicks, spend_credits FROM ad_campaign_daily_stats
     WHERE campaign_id = ${campaignId} AND date >= (CURRENT_DATE - ${days}::int)
     ORDER BY date ASC
  `);
  return result.rows;
}

export async function getCampaignTotals(userId: string): Promise<{ impressions: number; clicks: number; spend_credits: string }> {
  const orm = await getDb();
  const result = await orm.execute<{ impressions: string; clicks: string; spend_credits: string }>(sql`
    SELECT COALESCE(SUM(s.impressions),0)::text AS impressions,
            COALESCE(SUM(s.clicks),0)::text AS clicks,
            COALESCE(SUM(c.spent_credits),0)::text AS spend_credits
     FROM ad_campaigns c
     LEFT JOIN ad_campaign_daily_stats s ON s.campaign_id = c.id
     WHERE c.created_by = ${userId} AND c.deleted_at IS NULL
  `);
  const r = result.rows[0];
  return { impressions: Number(r?.impressions ?? 0), clicks: Number(r?.clicks ?? 0), spend_credits: r?.spend_credits ?? "0" };
}
