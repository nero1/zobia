export const dynamic = "force-dynamic";

/**
 * app/api/admin/game-milestones/<id>
 *
 * PUT    — update a milestone's rewards / active flag.
 * DELETE — remove a milestone.  Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { gamePlayMilestones } from "@/lib/db/schema";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";

const updateSchema = z.object({
  rewardCredits: z.number().int().min(0).optional(),
  rewardXp: z.number().int().min(0).optional(),
  rewardStars: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const PUT = withAdminAuth(
  async (req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const body = await validateBody(req, updateSchema);
      const updates: Partial<typeof gamePlayMilestones.$inferInsert> = {};
      if (body.rewardCredits !== undefined) updates.rewardCredits = body.rewardCredits;
      if (body.rewardXp !== undefined) updates.rewardXp = body.rewardXp;
      if (body.rewardStars !== undefined) updates.rewardStars = body.rewardStars;
      if (body.isActive !== undefined) updates.isActive = body.isActive;
      if (Object.keys(updates).length === 0) throw badRequest("No fields to update.");

      const orm = await getDb();
      const result = await orm
        .update(gamePlayMilestones)
        .set(updates)
        .where(eq(gamePlayMilestones.id, params.id))
        .returning({ id: gamePlayMilestones.id });
      if (result.length === 0) throw notFound("Milestone not found.");
      return NextResponse.json({ success: true, data: { id: params.id }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

export const DELETE = withAdminAuth(
  async (_req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const orm = await getDb();
      const result = await orm
        .delete(gamePlayMilestones)
        .where(eq(gamePlayMilestones.id, params.id))
        .returning({ id: gamePlayMilestones.id });
      if (result.length === 0) throw notFound("Milestone not found.");
      return NextResponse.json({ success: true, data: { deleted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
