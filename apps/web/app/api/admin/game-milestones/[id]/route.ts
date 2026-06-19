export const dynamic = "force-dynamic";

/**
 * app/api/admin/game-milestones/<id>
 *
 * PUT    — update a milestone's rewards / active flag.
 * DELETE — remove a milestone.  Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, type SqlParam } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";

const updateSchema = z.object({
  rewardCredits: z.number().int().min(0).optional(),
  rewardXp: z.number().int().min(0).optional(),
  rewardStars: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const COLUMN_MAP: Record<string, string> = {
  rewardCredits: "reward_credits",
  rewardXp: "reward_xp",
  rewardStars: "reward_stars",
  isActive: "is_active",
};

export const PUT = withAdminAuth(
  async (req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const body = await validateBody(req, updateSchema);
      const sets: string[] = [];
      const values: SqlParam[] = [];
      let i = 1;
      for (const [key, col] of Object.entries(COLUMN_MAP)) {
        if (key in body && body[key as keyof typeof body] !== undefined) {
          sets.push(`${col} = $${i++}`);
          values.push(body[key as keyof typeof body] as SqlParam);
        }
      }
      if (sets.length === 0) throw badRequest("No fields to update.");
      values.push(params.id);
      const { rowCount } = await db.query(
        `UPDATE game_play_milestones SET ${sets.join(", ")} WHERE id = $${i}`,
        values
      );
      if (!rowCount) throw notFound("Milestone not found.");
      return NextResponse.json({ success: true, data: { id: params.id }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

export const DELETE = withAdminAuth(
  async (_req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const { rowCount } = await db.query(`DELETE FROM game_play_milestones WHERE id = $1`, [params.id]);
      if (!rowCount) throw notFound("Milestone not found.");
      return NextResponse.json({ success: true, data: { deleted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
