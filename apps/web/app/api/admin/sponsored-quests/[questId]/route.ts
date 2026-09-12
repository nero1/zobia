export const dynamic = 'force-dynamic';

/**
 * app/api/admin/sponsored-quests/[questId]/route.ts
 *
 * Per-quest admin operations.
 *
 * PATCH /api/admin/sponsored-quests/:questId
 *   Update quest fields or toggle active status (edit / pause / activate).
 *
 * DELETE /api/admin/sponsored-quests/:questId
 *   Soft-delete a quest (sets deleted_at + is_active = FALSE).
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  brandName:            z.string().min(1).max(120).optional(),
  brandLogoUrl:         z.string().url().nullable().optional(),
  title:                z.string().min(3).max(150).optional(),
  description:          z.string().min(10).max(2000).optional(),
  requirements:         z.string().min(10).max(2000).optional(),
  rewardCoins:          z.number().int().positive().optional(),
  creatorSharePercent:  z.number().int().min(50).max(90).optional(),
  platformSharePercent: z.number().int().min(10).max(50).optional(),
  maxApplications:      z.number().int().positive().optional(),
  deadline:             z.string().datetime().optional(),
  minCreatorTier:       z.enum(["verified", "elite", "icon"]).optional(),
  isActive:             z.boolean().optional(),
  ownerUsername:        z.string().min(1).max(50).nullable().optional(),
  isDailyQuestEligible: z.boolean().optional(),
  startsAt:             z.string().datetime().nullable().optional(),
  endsAt:               z.string().datetime().nullable().optional(),
  totalBudgetCredits:   z.number().min(0).optional(),
  dailyBudgetCredits:   z.number().min(0).nullable().optional(),
  cpmCredits:           z.number().positive().optional(),
  targetAction:         z.string().min(1).max(100).nullable().optional(),
  targetValue:          z.number().int().positive().nullable().optional(),
});

interface QuestCtx {
  params: Promise<{ questId: string }>;
  auth: AdminContext;
}

export const PATCH = withAdminAuth(async (req: NextRequest, { params, auth }: QuestCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { questId } = await params;
    if (!UUID_RE.test(questId)) throw badRequest("questId must be a valid UUID");

    const body = await validateBody(req, patchSchema);

    // Validate share percents sum to 100 if both provided
    if (body.creatorSharePercent !== undefined && body.platformSharePercent !== undefined) {
      if (body.creatorSharePercent + body.platformSharePercent !== 100) {
        throw badRequest("creatorSharePercent + platformSharePercent must equal 100");
      }
    }

    // Deadline must be future if provided
    if (body.deadline && new Date(body.deadline) <= new Date()) {
      throw badRequest("deadline must be in the future");
    }

    // Verify quest exists
    const { rows: questRows } = await db.query<{ id: string; creator_share_percent: number; platform_share_percent: number }>(
      `SELECT id, creator_share_percent, platform_share_percent
       FROM sponsored_quests WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [questId]
    );
    if (!questRows[0]) throw notFound("Sponsored quest not found");

    // Build SET clause dynamically
    const setParts: string[] = ["updated_at = NOW()"];
    const values: SqlParam[] = [questId];
    let idx = 2;

    const fieldMap: Record<string, string> = {
      brandName:            "brand_name",
      brandLogoUrl:         "brand_logo_url",
      title:                "title",
      description:          "description",
      requirements:         "requirements",
      rewardCoins:          "reward_coins",
      creatorSharePercent:  "creator_share_percent",
      platformSharePercent: "platform_share_percent",
      maxApplications:      "max_applications",
      deadline:             "deadline",
      minCreatorTier:       "min_creator_tier",
      isActive:             "is_active",
      isDailyQuestEligible: "is_daily_quest_eligible",
      startsAt:             "starts_at",
      endsAt:               "ends_at",
      totalBudgetCredits:   "total_budget_credits",
      dailyBudgetCredits:   "daily_budget_credits",
      cpmCredits:           "cpm_credits",
      targetAction:         "target_action",
      targetValue:          "target_value",
    };

    if (body.ownerUsername !== undefined) {
      if (body.ownerUsername === null) {
        setParts.push(`owner_user_id = NULL`);
      } else {
        const { rows: ownerRows } = await db.query<{ id: string }>(
          `SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`,
          [body.ownerUsername]
        );
        if (!ownerRows[0]) throw badRequest(`No user found with username '${body.ownerUsername}'`);
        setParts.push(`owner_user_id = $${idx++}`);
        values.push(ownerRows[0].id);
      }
    }

    for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
      const val = (body as Record<string, unknown>)[jsKey];
      if (val !== undefined) {
        setParts.push(`${dbCol} = $${idx++}`);
        values.push(val as SqlParam);
      }
    }

    if (setParts.length === 1) {
      throw badRequest("No fields to update");
    }

    await db.query(
      `UPDATE sponsored_quests SET ${setParts.join(", ")} WHERE id = $1`,
      values
    );

    await syncSponsoredQuestTemplate(db, questId);

    return NextResponse.json({ success: true, data: { questId } });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth(async (req: NextRequest, { params, auth }: QuestCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { questId } = await params;
    if (!UUID_RE.test(questId)) throw badRequest("questId must be a valid UUID");

    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM sponsored_quests WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [questId]
    );
    if (!rows[0]) throw notFound("Sponsored quest not found");

    await db.query(
      `UPDATE sponsored_quests
       SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [questId]
    );
    await syncSponsoredQuestTemplate(db, questId);

    return NextResponse.json({ success: true, data: { questId, deleted: true } });
  } catch (err) {
    return handleApiError(err);
  }
});
