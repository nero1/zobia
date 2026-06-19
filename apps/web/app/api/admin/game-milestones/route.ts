export const dynamic = "force-dynamic";

/**
 * app/api/admin/game-milestones
 *
 * GET  — list global games-played milestones (gaming track).
 * POST — create a milestone.  Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
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
    const { rows } = await db.query(
      `SELECT id, games_played_threshold, reward_credits, reward_xp, reward_stars, is_active
       FROM game_play_milestones ORDER BY games_played_threshold ASC`
    );
    return NextResponse.json({ success: true, data: { milestones: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = await validateBody(req, createSchema);
    const { rows: dup } = await db.query<{ id: string }>(
      `SELECT id FROM game_play_milestones WHERE games_played_threshold = $1 LIMIT 1`,
      [body.gamesPlayedThreshold]
    );
    if (dup[0]) throw badRequest("A milestone with that threshold already exists.");

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO game_play_milestones
         (games_played_threshold, reward_credits, reward_xp, reward_stars, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [body.gamesPlayedThreshold, body.rewardCredits, body.rewardXp, body.rewardStars, body.isActive]
    );
    return NextResponse.json({ success: true, data: { id: rows[0].id }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
