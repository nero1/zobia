export const dynamic = "force-dynamic";

/**
 * app/api/admin/game-milestones
 *
 * GET  — list global games-played milestones (gaming track).
 * POST — create a milestone.  Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { gamePlayMilestones } from "@/lib/db/schema";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";

const createSchema = z.object({
  gamesPlayedThreshold: z.number().int().min(1).max(1_000_000),
  rewardCredits: z.number().int().min(0).default(0),
  rewardXp: z.number().int().min(0).default(0),
  rewardStars: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const orm = await getDb();
    const rows = await orm
      .select({
        id: gamePlayMilestones.id,
        gamesPlayedThreshold: gamePlayMilestones.gamesPlayedThreshold,
        rewardCredits: gamePlayMilestones.rewardCredits,
        rewardXp: gamePlayMilestones.rewardXp,
        rewardStars: gamePlayMilestones.rewardStars,
        isActive: gamePlayMilestones.isActive,
      })
      .from(gamePlayMilestones)
      .orderBy(asc(gamePlayMilestones.gamesPlayedThreshold));
    return NextResponse.json({ success: true, data: { milestones: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = await validateBody(req, createSchema);
    const orm = await getDb();

    const [dup] = await orm
      .select({ id: gamePlayMilestones.id })
      .from(gamePlayMilestones)
      .where(eq(gamePlayMilestones.gamesPlayedThreshold, body.gamesPlayedThreshold))
      .limit(1);
    if (dup) throw badRequest("A milestone with that threshold already exists.");

    const [created] = await orm
      .insert(gamePlayMilestones)
      .values({
        gamesPlayedThreshold: body.gamesPlayedThreshold,
        rewardCredits: body.rewardCredits,
        rewardXp: body.rewardXp,
        rewardStars: body.rewardStars,
        isActive: body.isActive,
      })
      .returning({ id: gamePlayMilestones.id });

    return NextResponse.json({ success: true, data: { id: created.id }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
