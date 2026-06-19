export const dynamic = "force-dynamic";

/**
 * app/api/admin/games/<id>/stats
 *
 * GET — detailed stats for a single game (plays, unique players, completions,
 * wins, rewards paid, challenges, wager volume). Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

export const GET = withAdminAuth(
  async (_req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const gameId = params.id;

      const { rows: gameRows } = await db.query<{ name: string }>(
        `SELECT name FROM games WHERE id = $1 LIMIT 1`,
        [gameId]
      );
      if (!gameRows[0]) throw notFound("Game not found.");

      const { rows: playRows } = await db.query<{
        total_plays: number;
        counted_plays: number;
        unique_players: number;
        avg_score: number | null;
        max_score: number | null;
      }>(
        `SELECT COUNT(*)::int AS total_plays,
                COUNT(*) FILTER (WHERE counted)::int AS counted_plays,
                COUNT(DISTINCT user_id)::int AS unique_players,
                AVG(score) FILTER (WHERE counted) AS avg_score,
                MAX(score) AS max_score
         FROM game_plays WHERE game_id = $1`,
        [gameId]
      );

      const { rows: rewardRows } = await db.query<{ rewards_paid: number }>(
        `SELECT COALESCE(SUM(wins), 0)::int AS rewards_paid
         FROM game_best_scores WHERE game_id = $1`,
        [gameId]
      );

      const { rows: challengeRows } = await db.query<{
        total: number;
        completed: number;
        wager_volume: number;
      }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COALESCE(SUM(escrow_credits), 0)::int AS wager_volume
         FROM game_challenges WHERE game_id = $1`,
        [gameId]
      );

      return NextResponse.json({
        success: true,
        data: {
          name: gameRows[0].name,
          plays: playRows[0],
          winsRewarded: rewardRows[0].rewards_paid,
          challenges: challengeRows[0],
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
