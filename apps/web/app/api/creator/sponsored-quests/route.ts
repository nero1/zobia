/**
 * app/api/creator/sponsored-quests/route.ts
 *
 * Sponsored Quest Marketplace.
 *
 * GET /api/creator/sponsored-quests
 *   - List active sponsored quests available for Verified+ creators to apply to.
 *   - Returns application count per quest and whether current user has applied.
 *   - Requires authentication.
 *
 * POST /api/creator/sponsored-quests
 *   - Admin creates a new sponsored quest.
 *   - Body: { brandName, title, description, requirements, rewardAmountCoins,
 *             creatorSharePercent?, platformSharePercent?, maxApplications, deadline }
 *   - Requires admin auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SponsoredQuestRow {
  id: string;
  brand_name: string;
  title: string;
  description: string;
  requirements: string;
  reward_amount_coins: number;
  creator_share_percent: number;
  platform_share_percent: number;
  max_applications: number;
  deadline: string;
  is_active: boolean;
  created_at: string;
  application_count: number;
  user_has_applied: boolean;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const createSponsoredQuestSchema = z.object({
  brandName: z.string().min(1).max(100),
  title: z.string().min(3).max(150),
  description: z.string().min(1).max(2000),
  requirements: z.string().min(1).max(2000),
  rewardAmountCoins: z.number().int().positive(),
  creatorSharePercent: z.number().int().min(0).max(100).default(70),
  platformSharePercent: z.number().int().min(0).max(100).default(30),
  maxApplications: z.number().int().positive(),
  deadline: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// GET /api/creator/sponsored-quests
// ---------------------------------------------------------------------------

/**
 * List active sponsored quests with application stats.
 * Available to any authenticated user.
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const { rows } = await db.query<SponsoredQuestRow>(
      `SELECT
         sq.id,
         sq.brand_name,
         sq.title,
         sq.description,
         sq.requirements,
         sq.reward_amount_coins,
         sq.creator_share_percent,
         sq.platform_share_percent,
         sq.max_applications,
         sq.deadline,
         sq.is_active,
         sq.created_at,
         COUNT(sqa.id)::int AS application_count,
         COALESCE(
           BOOL_OR(sqa.creator_id = $1), FALSE
         ) AS user_has_applied
       FROM sponsored_quests sq
       LEFT JOIN sponsored_quest_applications sqa ON sqa.quest_id = sq.id
       WHERE sq.is_active = TRUE
         AND sq.deadline > NOW()
       GROUP BY sq.id
       ORDER BY sq.created_at DESC`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: { quests: rows },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/sponsored-quests
// ---------------------------------------------------------------------------

/**
 * Admin creates a new sponsored quest.
 */
export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, createSponsoredQuestSchema);

    const insertResult = await db.query<{ id: string }>(
      `INSERT INTO sponsored_quests
         (brand_name, title, description, requirements, reward_amount_coins,
          creator_share_percent, platform_share_percent, max_applications,
          deadline, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW())
       RETURNING id`,
      [
        body.brandName,
        body.title,
        body.description,
        body.requirements,
        body.rewardAmountCoins,
        body.creatorSharePercent,
        body.platformSharePercent,
        body.maxApplications,
        body.deadline,
      ]
    );

    const quest = insertResult.rows[0];

    return NextResponse.json(
      { success: true, data: { questId: quest.id }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
