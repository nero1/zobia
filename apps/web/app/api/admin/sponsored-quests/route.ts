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
         COUNT(sqa.id)::int                                     AS application_count,
         COUNT(sqa.id) FILTER (WHERE sqa.status = 'approved')::int AS approved_count
       FROM sponsored_quests sq
       LEFT JOIN sponsored_quest_applications sqa ON sqa.quest_id = sq.id
       ${activeOnly ? "WHERE sq.is_active = TRUE" : ""}
       GROUP BY sq.id
       ORDER BY sq.created_at DESC`,
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

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO sponsored_quests
         (brand_name, brand_logo_url, title, description, requirements,
          reward_coins, creator_share_percent, platform_share_percent,
          max_applications, deadline, min_creator_tier, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,NOW())
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
      ]
    );

    return NextResponse.json(
      { success: true, data: { questId: rows[0].id }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
