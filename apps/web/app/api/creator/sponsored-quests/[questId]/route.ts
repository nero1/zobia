/**
 * app/api/creator/sponsored-quests/[questId]/route.ts
 *
 * GET /api/creator/sponsored-quests/[questId]
 *   - Returns detailed view of one sponsored quest including list of applications.
 *   - Requires authentication.
 *
 * PATCH /api/creator/sponsored-quests/[questId]
 *   - Admin updates quest fields (toggle is_active, update deadline).
 *   - Requires admin auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, SqlParam } from "@/lib/db";
import { withAuth, withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SponsoredQuestDetailRow {
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
}

interface ApplicationRow {
  id: string;
  quest_id: string;
  creator_id: string;
  room_id: string | null;
  status: string;
  applied_at: string;
  creator_username: string;
  creator_display_name: string;
  creator_avatar_emoji: string;
  creator_tier: string | null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const patchQuestSchema = z.object({
  isActive: z.boolean().optional(),
  deadline: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/creator/sponsored-quests/[questId]
// ---------------------------------------------------------------------------

/**
 * Detailed view of one sponsored quest with its applications.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: Promise<{ questId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { questId } = await params;
      const userId = auth.user.sub;

      await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

      // Fetch quest
      const questResult = await db.query<SponsoredQuestDetailRow>(
        `SELECT id, brand_name, title, description, requirements,
                reward_amount_coins, creator_share_percent, platform_share_percent,
                max_applications, deadline, is_active, created_at
         FROM sponsored_quests
         WHERE id = $1`,
        [questId]
      );
      const quest = questResult.rows[0];
      if (!quest) throw notFound("Sponsored quest not found");

      // Fetch applications with creator profile info
      const appsResult = await db.query<ApplicationRow>(
        `SELECT sqa.id, sqa.quest_id, sqa.creator_id, sqa.room_id, sqa.status, sqa.applied_at,
                u.username AS creator_username,
                u.display_name AS creator_display_name,
                u.avatar_emoji AS creator_avatar_emoji,
                u.creator_tier
         FROM sponsored_quest_applications sqa
         JOIN users u ON u.id = sqa.creator_id
         WHERE sqa.quest_id = $1
         ORDER BY sqa.applied_at ASC`,
        [questId]
      );

      return NextResponse.json({
        success: true,
        data: {
          quest,
          applications: appsResult.rows,
          applicationCount: appsResult.rows.length,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/creator/sponsored-quests/[questId]
// ---------------------------------------------------------------------------

/**
 * Admin updates a sponsored quest (toggle is_active, update deadline).
 */
export const PATCH = withAdminAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: Promise<{ questId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { questId } = await params;

      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const body = await validateBody(req, patchQuestSchema);

      // Verify quest exists
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM sponsored_quests WHERE id = $1`,
        [questId]
      );
      if (!existing.rows[0]) throw notFound("Sponsored quest not found");

      // Build dynamic update
      const updates: string[] = [];
      const values: SqlParam[] = [];
      let idx = 1;

      if (body.isActive !== undefined) {
        updates.push(`is_active = $${idx++}`);
        values.push(body.isActive);
      }
      if (body.deadline !== undefined) {
        updates.push(`deadline = $${idx++}`);
        values.push(body.deadline);
      }

      if (updates.length === 0) {
        return NextResponse.json({
          success: true,
          data: { updated: false, questId },
          error: null,
        });
      }

      values.push(questId);
      await db.query(
        `UPDATE sponsored_quests SET ${updates.join(", ")} WHERE id = $${idx}`,
        values
      );

      return NextResponse.json({
        success: true,
        data: { updated: true, questId },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
