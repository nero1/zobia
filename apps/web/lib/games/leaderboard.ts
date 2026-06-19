/**
 * lib/games/leaderboard.ts
 *
 * Per-game high-score leaderboards. Best scores live in Postgres
 * (game_best_scores) and are read with a plain ORDER BY, wrapped in a short
 * Redis cache so the hot directory/leaderboard reads stay cheap on the free
 * tier. The gaming *track* leaderboard (xp_gaming) is served by the existing
 * leaderboard engine via leaderboard_snapshots, not this module.
 */

import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { redis } from "@/lib/redis";
import type { GameLeaderboardRow } from "@zobia/types";
import { logger } from "@/lib/logger";

const PAGE_SIZE = 50;
const CACHE_TTL_SECONDS = 60;

function cacheKey(gameId: string, page: number): string {
  return `cache:lb:game:${gameId}:${page}`;
}

/**
 * Upsert a user's best score + counters for a game after a counted play.
 * Runs inside the caller's transaction when provided.
 */
export async function updateBestScore(
  gameId: string,
  userId: string,
  score: number,
  won: boolean,
  client?: TransactionClient
): Promise<void> {
  const runner = client ?? db;
  await runner.query(
    `INSERT INTO game_best_scores (game_id, user_id, best_score, plays, wins, updated_at)
     VALUES ($1, $2, $3, 1, $4, NOW())
     ON CONFLICT (game_id, user_id) DO UPDATE SET
       best_score = GREATEST(game_best_scores.best_score, EXCLUDED.best_score),
       plays      = game_best_scores.plays + 1,
       wins       = game_best_scores.wins + $4,
       updated_at = NOW()`,
    [gameId, userId, score, won ? 1 : 0]
  );
  // Best-effort cache bust for the first page (the page that changes most).
  redis.getdel(cacheKey(gameId, 1)).catch(() => {});
}

/** Top scores for a game (cached 60s). */
export async function getGameLeaderboard(
  gameId: string,
  page = 1
): Promise<{ rows: GameLeaderboardRow[]; page: number; pageSize: number }> {
  const safePage = Math.max(1, Math.floor(page));
  const key = cacheKey(gameId, safePage);

  if (safePage === 1) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        return { rows: JSON.parse(cached) as GameLeaderboardRow[], page: safePage, pageSize: PAGE_SIZE };
      }
    } catch {
      /* cache miss / redis blip — fall through to DB */
    }
  }

  const offset = (safePage - 1) * PAGE_SIZE;
  const { rows } = await db.query<{
    user_id: string;
    username: string;
    display_name: string;
    avatar_emoji: string;
    best_score: number;
    plays: number;
    wins: number;
    rank: number;
  }>(
    `SELECT b.user_id, u.username, u.display_name, u.avatar_emoji,
            b.best_score, b.plays, b.wins,
            RANK() OVER (ORDER BY b.best_score DESC)::int AS rank
     FROM game_best_scores b
     JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL
     WHERE b.game_id = $1
     ORDER BY b.best_score DESC
     LIMIT $2 OFFSET $3`,
    [gameId, PAGE_SIZE, offset]
  );

  const result: GameLeaderboardRow[] = rows.map((r) => ({
    rank: r.rank,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatarEmoji: r.avatar_emoji,
    bestScore: Number(r.best_score),
    plays: r.plays,
    wins: r.wins,
  }));

  if (safePage === 1) {
    redis
      .setex(key, CACHE_TTL_SECONDS, JSON.stringify(result))
      .catch((err) => logger.warn({ gameId }, `[games] leaderboard cache set failed: ${err}`));
  }

  return { rows: result, page: safePage, pageSize: PAGE_SIZE };
}
