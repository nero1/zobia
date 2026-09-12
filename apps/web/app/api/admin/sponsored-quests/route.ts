export const dynamic = 'force-dynamic';

/**
 * app/api/admin/sponsored-quests/route.ts
 *
 * Brand-facing / Admin Sponsored Quest Marketplace API (PRD §14).
 *
 * This is the authoritative admin endpoint for publishing and managing
 * Sponsored Quests — separate from the creator-facing endpoint
 * (POST /api/creator/sponsored-quests which is creator-apply only).
 *
 * GET  /api/admin/sponsored-quests
 *   List all sponsored quests with application stats. Admin only.
 *
 * POST /api/admin/sponsored-quests
 *   Publish a new sponsored quest on behalf of a brand. Admin only.
 *   Body: { brandName, brandLogoUrl?, title, description, requirements,
 *           rewardCoins, creatorSharePercent?, platformSharePercent?,
 *           maxApplications, deadline, minCreatorTier? }
 *
 * PATCH /api/admin/sponsored-quests/:questId
 *   Update quest details, deadline, or active status. Admin only.
 *
 * DELETE /api/admin/sponsored-quests/:questId
 *   Deactivate (soft-delete) a quest. Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { estimateSponsoredQuestReach, syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createQuestSchema = z.object({
  brandName:           z.string().min(1).max(120),
  brandLogoUrl:        z.string().url().optional().nullable(),
  title:               z.string().min(3).max(150),
  description:         z.string().min(10).max(2000),
  requirements:        z.string().min(10).max(2000),
  rewardCoins:   z.number().int().positive(),
  creatorSharePercent: z.number().int().min(50).max(90).default(70),
  platformSharePercent:z.number().int().min(10).max(50).default(30),
  maxApplications:     z.number().int().positive().default(10),
  deadline:            z.string().datetime(),
  minCreatorTier:      z.enum(["verified","elite","icon"]).default("verified"),
  // Admin-assigned quest "creator"/campaign manager — gets read/manage
  // access at /quests/manage (stats, revive/extend). Not the same as a
  // business self-service submitter (submittedBy).
  ownerUsername:       z.string().min(1).max(50).optional().nullable(),
  // Daily-deck distribution + billing (Facebook-Ads-style duration+budget,
  // impression-paced under the hood — see lib/quests/sponsoredQuestPacing.ts).
  isDailyQuestEligible: z.boolean().default(false),
  startsAt:            z.string().datetime().optional().nullable(),
  endsAt:              z.string().datetime().optional().nullable(),
  totalBudgetCredits:  z.number().min(0).default(0),
  dailyBudgetCredits:  z.number().min(0).optional().nullable(),
  cpmCredits:          z.number().positive().default(500),
  targetAction:        z.string().min(1).max(100).optional().nullable(),
  targetValue:         z.number().int().positive().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SponsoredQuestAdminRow {
  id: string;
  brand_name: string;
  brand_logo_url: string | null;
  title: string;
  description: string;
  requirements: string;
  reward_coins: number;
  creator_share_percent: number;
  platform_share_percent: number;
  max_applications: number;
  deadline: string;
  min_creator_tier: string | null;
  is_active: boolean;
  created_at: string;
  application_count: number;
  approved_count: number;
  moderation_status: string;
  moderation_reason: string | null;
  business_account_id: string | null;
  submitted_by_username: string | null;
  owner_username: string | null;
  auto_paused: boolean;
  pause_reason: string | null;
  flag_status: string;
  flag_category: string | null;
  flag_reason: string | null;
  is_daily_quest_eligible: boolean;
  pricing_model: string;
  total_budget_credits: string;
  spent_credits: string;
  daily_budget_credits: string | null;
  cpm_credits: string;
  estimated_reach: number | null;
  impressions_count: number;
  completions_count: number;
  starts_at: string | null;
  ends_at: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/sponsored-quests
// ---------------------------------------------------------------------------

/**
 * List all sponsored quests with per-quest stats.
 * Admin only.
 */
export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const url = new URL(req.url);
    const activeOnly = url.searchParams.get("active") !== "false";
    const moderationStatus = url.searchParams.get("moderationStatus");

    const conditions: string[] = ["sq.deleted_at IS NULL"];
    if (activeOnly) conditions.push("sq.is_active = TRUE");
    if (moderationStatus && ["pending", "approved", "rejected"].includes(moderationStatus)) {
      conditions.push(`sq.moderation_status = '${moderationStatus}'`);
    }

    const { rows } = await db.query<SponsoredQuestAdminRow>(
      `SELECT
         sq.id,
         sq.brand_name,
         sq.brand_logo_url,
         sq.title,
         sq.description,
         sq.requirements,
         sq.reward_coins,
         sq.creator_share_percent,
         sq.platform_share_percent,
         sq.max_applications,
         sq.deadline,
         sq.min_creator_tier,
         sq.is_active,
         sq.created_at,
         sq.moderation_status,
         sq.moderation_reason,
         sq.business_account_id,
         u.username AS submitted_by_username,
         owner.username AS owner_username,
         sq.auto_paused,
         sq.pause_reason,
         sq.flag_status,
         sq.flag_category,
         sq.flag_reason,
         sq.is_daily_quest_eligible,
         sq.pricing_model,
         sq.total_budget_credits,
         sq.spent_credits,
         sq.daily_budget_credits,
         sq.cpm_credits,
         sq.estimated_reach,
         sq.impressions_count,
         sq.completions_count,
         sq.starts_at,
         sq.ends_at,
         COUNT(sqa.id)::int                                     AS application_count,
         COUNT(sqa.id) FILTER (WHERE sqa.status = 'approved')::int AS approved_count
       FROM sponsored_quests sq
       LEFT JOIN sponsored_quest_applications sqa ON sqa.quest_id = sq.id
       LEFT JOIN users u ON u.id = sq.submitted_by
       LEFT JOIN users owner ON owner.id = sq.owner_user_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY sq.id, u.username, owner.username
       ORDER BY (sq.moderation_status = 'pending') DESC, sq.created_at DESC`,
    );

    return NextResponse.json({
      success: true,
      data: { quests: rows, total: rows.length },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/sponsored-quests
// ---------------------------------------------------------------------------

/**
 * Publish a new sponsored quest on behalf of a brand.
 * Admin only. Sets `is_active = TRUE` immediately.
 */
export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, createQuestSchema);

    // creator + platform shares must sum to 100
    if (body.creatorSharePercent + body.platformSharePercent !== 100) {
      throw badRequest("creatorSharePercent + platformSharePercent must equal 100");
    }

    // Deadline must be in the future
    if (new Date(body.deadline) <= new Date()) {
      throw badRequest("deadline must be in the future");
    }
    if (body.isDailyQuestEligible && body.startsAt && body.endsAt && new Date(body.endsAt) <= new Date(body.startsAt)) {
      throw badRequest("endsAt must be after startsAt");
    }

    let ownerUserId: string | null = null;
    if (body.ownerUsername) {
      const { rows: ownerRows } = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`,
        [body.ownerUsername]
      );
      if (!ownerRows[0]) throw badRequest(`No user found with username '${body.ownerUsername}'`);
      ownerUserId = ownerRows[0].id;
    }

    const durationDays = body.startsAt && body.endsAt
      ? Math.max(1, Math.round((new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()) / 86_400_000))
      : 7;
    const estimatedReach = body.isDailyQuestEligible
      ? estimateSponsoredQuestReach(body.totalBudgetCredits, body.cpmCredits, durationDays).totalImpressions
      : null;

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO sponsored_quests
         (brand_name, brand_logo_url, title, description, requirements,
          reward_coins, creator_share_percent, platform_share_percent,
          max_applications, deadline, min_creator_tier, is_active, created_at,
          owner_user_id, is_daily_quest_eligible, starts_at, ends_at,
          pricing_model, total_budget_credits, daily_budget_credits, cpm_credits,
          estimated_reach, funded_by_user_id, target_action, target_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,NOW(),
               $12,$13,$14,$15,'hybrid',$16,$17,$18,$19,$20,$21,$22)
       RETURNING id`,
      [
        body.brandName,
        body.brandLogoUrl ?? null,
        body.title,
        body.description,
        body.requirements,
        body.rewardCoins,
        body.creatorSharePercent,
        body.platformSharePercent,
        body.maxApplications,
        body.deadline,
        body.minCreatorTier,
        ownerUserId,
        body.isDailyQuestEligible,
        body.startsAt ?? null,
        body.endsAt ?? null,
        body.totalBudgetCredits,
        body.dailyBudgetCredits ?? null,
        body.cpmCredits,
        estimatedReach,
        auth.user.sub,
        body.targetAction ?? null,
        body.targetValue ?? null,
      ]
    );

    if (body.isDailyQuestEligible) {
      await syncSponsoredQuestTemplate(db, rows[0].id);
    }

    return NextResponse.json(
      { success: true, data: { questId: rows[0].id }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
