/**
 * lib/games/repo.ts
 *
 * Read/query helpers for games. The DB is the runtime source of truth for a
 * game's cover-page content, reward config and play cost; the shared registry
 * (shared/utils/games) is the source of truth for which engine renders it.
 */

import { db } from "@/lib/db";
import type { GameCategory, GameSummary } from "@zobia/types";

export interface GameConfigRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  long_description: string | null;
  cover_emoji: string;
  cover_image_url: string | null;
  category: string | null;
  engine_key: string | null;
  reward_credits_per_win: number;
  reward_xp_per_win: number;
  reward_stars_per_win: number;
  play_cost_credits: number;
  play_cost_stars: number;
  max_score: number | null;
  min_play_seconds: number;
  play_count: number;
  avg_rating: number;
  rating_count: number;
  is_active: boolean;
  is_public: boolean;
  created_at: string;
}

const SUMMARY_COLUMNS = `
  id, slug, name, tagline, description, long_description, cover_emoji,
  cover_image_url, category, engine_key,
  reward_credits_per_win, reward_xp_per_win, reward_stars_per_win,
  play_cost_credits, play_cost_stars, max_score, min_play_seconds,
  play_count, avg_rating, rating_count, is_active, is_public, created_at
`;

function toSummary(row: GameConfigRow): GameSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    longDescription: row.long_description,
    coverEmoji: row.cover_emoji,
    coverImageUrl: row.cover_image_url,
    category: (row.category as GameCategory | null) ?? null,
    engineKey: row.engine_key,
    rewardCreditsPerWin: row.reward_credits_per_win,
    rewardXpPerWin: row.reward_xp_per_win,
    rewardStarsPerWin: row.reward_stars_per_win,
    playCostCredits: row.play_cost_credits,
    playCostStars: row.play_cost_stars,
    playCount: Number(row.play_count),
    avgRating: Number(row.avg_rating ?? 0),
    ratingCount: Number(row.rating_count ?? 0),
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** All active, public games for the directory, ordered by category + sort. */
export async function getActiveGames(): Promise<GameSummary[]> {
  const { rows } = await db.query<GameConfigRow>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM games
     WHERE deleted_at IS NULL AND is_active = TRUE AND is_public = TRUE
     ORDER BY category NULLS LAST, sort_order ASC, name ASC`
  );
  return rows.map(toSummary);
}

export interface GameListOptions {
  tab?: "new" | "popular" | "trending";
  category?: string;
  free?: boolean;
  /**
   * Opaque pagination cursor returned by the previous page.
   * "new" tab: ISO timestamp string.
   * "popular" tab: base64url-encoded JSON { play_count, id }.
   * "trending" tab: base64url-encoded JSON { recent_plays, id }.
   */
  cursor?: string;
  limit?: number;
}

export interface GameListResult {
  games: GameSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Paginated, filterable game list for the discovery page.
 * Trending = most plays in the last N hours (default 72).
 * Popular = highest all-time play_count.
 * New = most recently created.
 */
export async function listGames(opts: GameListOptions = {}): Promise<GameListResult> {
  const { tab = "popular", category, free, cursor, limit: rawLimit = 24 } = opts;
  const limit = Math.min(rawLimit, 50);
  const params: (string | number | boolean | null)[] = [];
  const where: string[] = [
    "g.deleted_at IS NULL",
    "g.is_active = TRUE",
    "g.is_public = TRUE",
  ];

  if (category) {
    params.push(category);
    where.push(`g.category = $${params.length}`);
  }

  if (free === true) {
    where.push(`g.play_cost_credits = 0 AND g.play_cost_stars = 0`);
  } else if (free === false) {
    where.push(`(g.play_cost_credits > 0 OR g.play_cost_stars > 0)`);
  }

  let orderBy: string;
  let trendingJoin = "";
  let extraSelect = "";

  if (tab === "new") {
    if (cursor) {
      params.push(cursor);
      where.push(`g.created_at < $${params.length}`);
    }
    orderBy = "g.created_at DESC";
  } else if (tab === "trending") {
    trendingJoin = `
      LEFT JOIN (
        SELECT game_id, COUNT(*) AS recent_plays
        FROM game_plays
        WHERE started_at > NOW() - INTERVAL '72 hours'
        GROUP BY game_id
      ) tp ON tp.game_id = g.id
    `;
    extraSelect = ", COALESCE(tp.recent_plays, 0) AS recent_plays";
    if (cursor) {
      try {
        const { recent_plays: cp, id: cid } = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf-8")
        ) as { recent_plays: number; id: string };
        params.push(cp, cid);
        const pN = params.length - 1;
        where.push(
          `(COALESCE(tp.recent_plays, 0) < $${pN} OR (COALESCE(tp.recent_plays, 0) = $${pN} AND g.id < $${pN + 1}::uuid))`
        );
      } catch { /* invalid cursor — ignore, return first page */ }
    }
    orderBy = "COALESCE(tp.recent_plays, 0) DESC, g.play_count DESC";
  } else {
    // popular (default)
    if (cursor) {
      try {
        const { play_count: cp, id: cid } = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf-8")
        ) as { play_count: number; id: string };
        params.push(cp, cid);
        const pN = params.length - 1;
        where.push(
          `(g.play_count < $${pN} OR (g.play_count = $${pN} AND g.id < $${pN + 1}::uuid))`
        );
      } catch { /* invalid cursor — ignore, return first page */ }
    }
    orderBy = "g.play_count DESC, g.avg_rating DESC";
  }

  params.push(limit + 1);
  const rows_param = `$${params.length}`;

  const { rows } = await db.query<GameConfigRow & { recent_plays?: number }>(
    `SELECT ${SUMMARY_COLUMNS}${extraSelect}
     FROM games g
     ${trendingJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT ${rows_param}`,
    params
  );

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    if (tab === "new") {
      nextCursor = last.created_at;
    } else if (tab === "popular") {
      nextCursor = Buffer.from(
        JSON.stringify({ play_count: last.play_count, id: last.id })
      ).toString("base64url");
    } else {
      // trending
      nextCursor = Buffer.from(
        JSON.stringify({ recent_plays: last.recent_plays ?? 0, id: last.id })
      ).toString("base64url");
    }
  }

  return {
    games: items.map(toSummary),
    nextCursor,
    hasMore,
  };
}

/** Full config for a single live game by slug (active + public only). */
export async function getActiveGameBySlug(slug: string): Promise<GameConfigRow | null> {
  const { rows } = await db.query<GameConfigRow>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM games g
     WHERE slug = $1 AND deleted_at IS NULL AND is_active = TRUE AND is_public = TRUE
     LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

/** Public summary for a single live game by slug. */
export async function getGameSummaryBySlug(slug: string): Promise<GameSummary | null> {
  const row = await getActiveGameBySlug(slug);
  return row ? toSummary(row) : null;
}

/** Full config for a game by id, ignoring active flag (admin / internal use). */
export async function getGameById(id: string): Promise<GameConfigRow | null> {
  const { rows } = await db.query<GameConfigRow>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM games g
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Get a user's rating for a specific game, if any. */
export async function getUserGameRating(gameId: string, userId: string): Promise<number | null> {
  const { rows } = await db.query<{ rating: number }>(
    `SELECT rating FROM game_ratings WHERE game_id = $1 AND user_id = $2 LIMIT 1`,
    [gameId, userId]
  );
  return rows[0]?.rating ?? null;
}

/** Upsert a user's rating and update the game's avg_rating + rating_count. */
export async function upsertGameRating(
  gameId: string,
  userId: string,
  rating: 1 | 2 | 3 | 4 | 5
): Promise<{ avgRating: number; ratingCount: number }> {
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO game_ratings (game_id, user_id, rating, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (game_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
      [gameId, userId, rating]
    );
    await tx.query(
      `UPDATE games
       SET avg_rating = (SELECT AVG(rating) FROM game_ratings WHERE game_id = $1),
           rating_count = (SELECT COUNT(*) FROM game_ratings WHERE game_id = $1),
           updated_at = NOW()
       WHERE id = $1`,
      [gameId]
    );
  });

  const { rows } = await db.query<{ avg_rating: number; rating_count: number }>(
    `SELECT avg_rating, rating_count FROM games WHERE id = $1`,
    [gameId]
  );
  return {
    avgRating: Number(rows[0]?.avg_rating ?? 0),
    ratingCount: Number(rows[0]?.rating_count ?? 0),
  };
}
