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
    };

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

    return NextResponse.json({ success: true, data: { questId, deleted: true } });
  } catch (err) {
    return handleApiError(err);
  }
});
