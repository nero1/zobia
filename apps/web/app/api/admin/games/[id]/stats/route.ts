export const dynamic = "force-dynamic";

/**
 * app/api/admin/games/<id>/stats
 *
 * GET — detailed stats for a single game (plays, unique players, completions,
 * wins, rewards paid, challenges, wager volume). Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

export const GET = withAdminAuth(
  async (_req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const gameId = params.id;
      const orm = await getDb();

      const { rows: gameRows } = await orm.execute<{ name: string }>(
        sql`SELECT name FROM games WHERE id = ${gameId} LIMIT 1`
      );
      if (!gameRows[0]) throw notFound("Game not found.");

      const { rows: playRows } = await orm.execute<{
        total_plays: number;
        counted_plays: number;
        unique_players: number;
        avg_score: number | null;
        max_score: number | null;
      }>(sql`
        SELECT COUNT(*)::int AS total_plays,
                COUNT(*) FILTER (WHERE counted)::int AS counted_plays,
                COUNT(DISTINCT user_id)::int AS unique_players,
                AVG(score) FILTER (WHERE counted) AS avg_score,
                MAX(score) AS max_score
         FROM game_plays WHERE game_id = ${gameId}
      `);

      const { rows: rewardRows } = await orm.execute<{ rewards_paid: number }>(sql`
        SELECT COALESCE(SUM(wins), 0)::int AS rewards_paid
         FROM game_best_scores WHERE game_id = ${gameId}
      `);

      const { rows: challengeRows } = await orm.execute<{
        total: number;
        completed: number;
        wager_volume: number;
      }>(sql`
        SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COALESCE(SUM(escrow_credits), 0)::int AS wager_volume
         FROM game_challenges WHERE game_id = ${gameId}
      `);

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
