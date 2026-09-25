/**
 * lib/games/repo.ts
 *
 * Read/query helpers for games. The DB is the runtime source of truth for a
 * game's cover-page content, reward config and play cost; the shared registry
 * (shared/utils/games) is the source of truth for which engine renders it.
 */

import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
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
  favorite_count: number;
  is_active: boolean;
  is_public: boolean;
  created_at: string;
  /** Only present when the query joins game_favorites for a specific viewer. */
  is_favorited?: boolean;
}

const SUMMARY_COLUMNS = sql.raw(`
  id, slug, name, tagline, description, long_description, cover_emoji,
  cover_image_url, category, engine_key,
  reward_credits_per_win, reward_xp_per_win, reward_stars_per_win,
  play_cost_credits, play_cost_stars, max_score, min_play_seconds,
  play_count, avg_rating, rating_count, favorite_count, is_active, is_public, created_at
`);

// Table-qualified variant for queries that alias `games` as `g` and join
// other tables that also have an `id` column (e.g. game_favorites) — avoids
// "column reference is ambiguous" errors.
const SUMMARY_COLUMNS_G = sql.raw(`
  g.id, g.slug, g.name, g.tagline, g.description, g.long_description, g.cover_emoji,
  g.cover_image_url, g.category, g.engine_key,
  g.reward_credits_per_win, g.reward_xp_per_win, g.reward_stars_per_win,
  g.play_cost_credits, g.play_cost_stars, g.max_score, g.min_play_seconds,
  g.play_count, g.avg_rating, g.rating_count, g.favorite_count, g.is_active, g.is_public, g.created_at
`);

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
    favoriteCount: Number(row.favorite_count ?? 0),
    ...(row.is_favorited !== undefined ? { isFavorited: row.is_favorited } : {}),
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** All active, public games for the directory, ordered by category + sort. */
export async function getActiveGames(userId?: string): Promise<GameSummary[]> {
  const db = await getDb();
  const favSelect = userId ? sql`, (gf.id IS NOT NULL) AS is_favorited` : sql``;
  const favJoin = userId
    ? sql`LEFT JOIN game_favorites gf ON gf.game_id = g.id AND gf.user_id = ${userId}`
    : sql``;
  const result = await db.execute<GameConfigRow & Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS_G}${favSelect}
    FROM games g
    ${favJoin}
    WHERE g.deleted_at IS NULL AND g.is_active = TRUE AND g.is_public = TRUE
    ORDER BY g.category NULLS LAST, g.sort_order ASC, g.name ASC
  `);
  return result.rows.map(toSummary);
}

export interface GameListOptions {
  tab?: "new" | "popular" | "trending" | "random";
  category?: string;
  free?: boolean;
  /** Case-insensitive substring match against name/tagline (discovery search bar). */
  q?: string;
  /** When set, joins game_favorites so each result carries `isFavorited`. */
  userId?: string;
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
  const { tab = "popular", category, free, q, userId, cursor, limit: rawLimit = 24 } = opts;
  const limit = Math.min(rawLimit, 50);
  const db = await getDb();

  const where: SQL[] = [
    sql`g.deleted_at IS NULL`,
    sql`g.is_active = TRUE`,
    sql`g.is_public = TRUE`,
  ];

  if (category) {
    where.push(sql`g.category = ${category}`);
  }

  if (free === true) {
    where.push(sql`g.play_cost_credits = 0 AND g.play_cost_stars = 0`);
  } else if (free === false) {
    where.push(sql`(g.play_cost_credits > 0 OR g.play_cost_stars > 0)`);
  }

  if (q && q.trim()) {
    const pattern = `%${q.trim()}%`;
    where.push(sql`(g.name ILIKE ${pattern} OR g.tagline ILIKE ${pattern})`);
  }

  let favSelect: SQL = sql``;
  let favJoin: SQL = sql``;
  if (userId) {
    favSelect = sql`, (gf.id IS NOT NULL) AS is_favorited`;
    favJoin = sql`LEFT JOIN game_favorites gf ON gf.game_id = g.id AND gf.user_id = ${userId}`;
  }

  let orderBy: SQL;
  let trendingJoin: SQL = sql``;
  let extraSelect: SQL = favSelect;

  if (tab === "random") {
    // Random tab: no meaningful cursor over ORDER BY random() — each fetch
    // (including "Load more") returns a fresh shuffled batch instead of a
    // stable page, same tradeoff as any "shuffle" feature at this scale.
    orderBy = sql`random()`;
  } else if (tab === "new") {
    if (cursor) {
      where.push(sql`g.created_at < ${cursor}`);
    }
    orderBy = sql`g.created_at DESC`;
  } else if (tab === "trending") {
    trendingJoin = sql`
      LEFT JOIN (
        SELECT game_id, COUNT(*) AS recent_plays
        FROM game_plays
        WHERE started_at > NOW() - INTERVAL '72 hours'
        GROUP BY game_id
      ) tp ON tp.game_id = g.id
    `;
    extraSelect = sql`${extraSelect}, COALESCE(tp.recent_plays, 0) AS recent_plays`;
    if (cursor) {
      try {
        const { recent_plays: cp, id: cid } = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf-8")
        ) as { recent_plays: number; id: string };
        where.push(
          sql`(COALESCE(tp.recent_plays, 0) < ${cp} OR (COALESCE(tp.recent_plays, 0) = ${cp} AND g.id < ${cid}::uuid))`
        );
      } catch { /* invalid cursor — ignore, return first page */ }
    }
    orderBy = sql`COALESCE(tp.recent_plays, 0) DESC, g.play_count DESC`;
  } else {
    // popular (default)
    if (cursor) {
      try {
        const { play_count: cp, id: cid } = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf-8")
        ) as { play_count: number; id: string };
        where.push(
          sql`(g.play_count < ${cp} OR (g.play_count = ${cp} AND g.id < ${cid}::uuid))`
        );
      } catch { /* invalid cursor — ignore, return first page */ }
    }
    orderBy = sql`g.play_count DESC, g.avg_rating DESC`;
  }

  const whereClause = sql.join(where, sql` AND `);

  const result = await db.execute<GameConfigRow & Record<string, unknown> & { recent_plays?: number }>(sql`
    SELECT ${SUMMARY_COLUMNS_G}${extraSelect}
    FROM games g
    ${trendingJoin}
    ${favJoin}
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${limit + 1}
  `);
  const rows = result.rows;

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  // Random has no stable cursor — "Load more" just re-shuffles (hasMore stays
  // false so the page renders a "Shuffle again" affordance instead).
  if (hasMore && items.length > 0 && tab !== "random") {
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
    hasMore: tab === "random" ? false : hasMore,
  };
}

/** Full config for a single live game by slug (active + public only). */
export async function getActiveGameBySlug(slug: string): Promise<GameConfigRow | null> {
  const db = await getDb();
  const result = await db.execute<GameConfigRow & Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS}
    FROM games g
    WHERE slug = ${slug} AND deleted_at IS NULL AND is_active = TRUE AND is_public = TRUE
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

/** Public summary for a single live game by slug. */
export async function getGameSummaryBySlug(slug: string): Promise<GameSummary | null> {
  const row = await getActiveGameBySlug(slug);
  return row ? toSummary(row) : null;
}

/** Full config for a game by id, ignoring active flag (admin / internal use). */
export async function getGameById(id: string): Promise<GameConfigRow | null> {
  const db = await getDb();
  const result = await db.execute<GameConfigRow & Record<string, unknown>>(sql`
    SELECT ${SUMMARY_COLUMNS}
    FROM games g
    WHERE id = ${id} AND deleted_at IS NULL
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

/** Get a user's rating for a specific game, if any. */
export async function getUserGameRating(gameId: string, userId: string): Promise<number | null> {
  const db = await getDb();
  const result = await db.execute<{ rating: number }>(
    sql`SELECT rating FROM game_ratings WHERE game_id = ${gameId} AND user_id = ${userId} LIMIT 1`
  );
  return result.rows[0]?.rating ?? null;
}

/** Upsert a user's rating and update the game's avg_rating + rating_count. */
export async function upsertGameRating(
  gameId: string,
  userId: string,
  rating: 1 | 2 | 3 | 4 | 5
): Promise<{ avgRating: number; ratingCount: number }> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO game_ratings (game_id, user_id, rating, updated_at)
      VALUES (${gameId}, ${userId}, ${rating}, NOW())
      ON CONFLICT (game_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()
    `);
    await tx.execute(sql`
      UPDATE games
      SET avg_rating = (SELECT AVG(rating) FROM game_ratings WHERE game_id = ${gameId}),
          rating_count = (SELECT COUNT(*) FROM game_ratings WHERE game_id = ${gameId}),
          updated_at = NOW()
      WHERE id = ${gameId}
    `);
  });

  const db = await getDb();
  const result = await db.execute<{ avg_rating: number; rating_count: number }>(
    sql`SELECT avg_rating, rating_count FROM games WHERE id = ${gameId}`
  );
  return {
    avgRating: Number(result.rows[0]?.avg_rating ?? 0),
    ratingCount: Number(result.rows[0]?.rating_count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Favorites ("❤️ Faves") — mirrors lib pattern used by room_pins/rooms/pinned.
// ---------------------------------------------------------------------------

/** The user's favorited games, most-recently-favorited first (cursor on favorited_at). */
export async function listFavoriteGames(
  userId: string,
  cursor?: string,
  limit = 24
): Promise<GameListResult> {
  const pageSize = Math.min(limit, 50);
  const db = await getDb();
  const cursorClause = cursor ? sql`AND gf.created_at < ${cursor}` : sql``;

  const result = await db.execute<GameConfigRow & Record<string, unknown> & { favorited_at: string }>(sql`
    SELECT ${SUMMARY_COLUMNS_G}, TRUE AS is_favorited, gf.created_at AS favorited_at
    FROM game_favorites gf
    JOIN games g ON g.id = gf.game_id AND g.deleted_at IS NULL AND g.is_active = TRUE AND g.is_public = TRUE
    WHERE gf.user_id = ${userId} ${cursorClause}
    ORDER BY gf.created_at DESC
    LIMIT ${pageSize + 1}
  `);
  const rows = result.rows;

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].favorited_at : null;

  return { games: items.map(toSummary), nextCursor, hasMore };
}

/** Toggle a game as favorited for a user. Returns the new favorited state + count. */
export async function setGameFavorite(
  userId: string,
  gameId: string,
  favorited: boolean
): Promise<{ favorited: boolean; favoriteCount: number }> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    if (favorited) {
      const insertResult = await tx.execute<{ id: string }>(sql`
        INSERT INTO game_favorites (user_id, game_id) VALUES (${userId}, ${gameId})
        ON CONFLICT (user_id, game_id) DO NOTHING
        RETURNING id
      `);
      if (insertResult.rows.length > 0) {
        await tx.execute(sql`UPDATE games SET favorite_count = favorite_count + 1 WHERE id = ${gameId}`);
      }
    } else {
      const deleteResult = await tx.execute<{ id: string }>(
        sql`DELETE FROM game_favorites WHERE user_id = ${userId} AND game_id = ${gameId} RETURNING id`
      );
      if (deleteResult.rows.length > 0) {
        await tx.execute(
          sql`UPDATE games SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ${gameId}`
        );
      }
    }
  });

  const db = await getDb();
  const result = await db.execute<{ favorite_count: number }>(
    sql`SELECT favorite_count FROM games WHERE id = ${gameId}`
  );
  return { favorited, favoriteCount: Number(result.rows[0]?.favorite_count ?? 0) };
}

// ---------------------------------------------------------------------------
// Recently Played — reuses game_plays (no new table; PRD "Recently Played"
// tab is a thin recency view over sessions that already exist).
// ---------------------------------------------------------------------------

/** Distinct games the user has played, most-recently-played first. */
export async function listRecentlyPlayedGames(
  userId: string,
  cursor?: string,
  limit = 24
): Promise<GameListResult> {
  const pageSize = Math.min(limit, 50);
  const db = await getDb();
  const cursorClause = cursor ? sql`AND lp.last_played_at < ${cursor}` : sql``;

  const result = await db.execute<GameConfigRow & Record<string, unknown> & { last_played_at: string }>(sql`
    WITH last_plays AS (
      SELECT game_id, MAX(started_at) AS last_played_at
      FROM game_plays
      WHERE user_id = ${userId}
      GROUP BY game_id
    )
    SELECT ${SUMMARY_COLUMNS_G}, (gf.id IS NOT NULL) AS is_favorited, lp.last_played_at
    FROM last_plays lp
    JOIN games g ON g.id = lp.game_id AND g.deleted_at IS NULL AND g.is_active = TRUE AND g.is_public = TRUE
    LEFT JOIN game_favorites gf ON gf.game_id = g.id AND gf.user_id = ${userId}
    WHERE TRUE ${cursorClause}
    ORDER BY lp.last_played_at DESC
    LIMIT ${pageSize + 1}
  `);
  const rows = result.rows;

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].last_played_at : null;

  return { games: items.map(toSummary), nextCursor, hasMore };
}
