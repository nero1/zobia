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
  is_active: boolean;
  is_public: boolean;
}

const SUMMARY_COLUMNS = `
  id, slug, name, tagline, description, long_description, cover_emoji,
  cover_image_url, category, engine_key,
  reward_credits_per_win, reward_xp_per_win, reward_stars_per_win,
  play_cost_credits, play_cost_stars, max_score, min_play_seconds,
  play_count, is_active, is_public
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
    isActive: row.is_active,
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

/** Full config for a single live game by slug (active + public only). */
export async function getActiveGameBySlug(slug: string): Promise<GameConfigRow | null> {
  const { rows } = await db.query<GameConfigRow>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM games
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
     FROM games
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}
