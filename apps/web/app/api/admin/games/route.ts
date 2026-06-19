export const dynamic = "force-dynamic";

/**
 * app/api/admin/games
 *
 * GET  — list every game (active + inactive) with summary stats.
 * POST — create a new game (cover page + reward/play-cost config).
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { generateUniqueSlug } from "@/lib/slug";
import { GAME_CATEGORIES } from "@zobia/types";

const categoryEnum = z.enum(GAME_CATEGORIES as unknown as [string, ...string[]]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  category: categoryEnum,
  engineKey: z.string().min(1).max(60),
  tagline: z.string().max(160).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  longDescription: z.string().max(8000).optional().nullable(),
  coverEmoji: z.string().min(1).max(8).default("🎮"),
  coverImageUrl: z.string().url().max(500).optional().nullable(),
  rewardCreditsPerWin: z.number().int().min(0).default(0),
  rewardXpPerWin: z.number().int().min(0).default(0),
  rewardStarsPerWin: z.number().int().min(0).default(0),
  playCostCredits: z.number().int().min(0).default(0),
  playCostStars: z.number().int().min(0).default(0),
  maxScore: z.number().int().min(0).optional().nullable(),
  minPlaySeconds: z.number().int().min(0).max(86400).default(0),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const { rows } = await db.query(
      `SELECT g.id, g.slug, g.name, g.category, g.engine_key, g.cover_emoji,
              g.cover_image_url, g.tagline, g.is_active, g.is_public, g.sort_order,
              g.reward_credits_per_win, g.reward_xp_per_win, g.reward_stars_per_win,
              g.play_cost_credits, g.play_cost_stars, g.max_score, g.min_play_seconds,
              g.play_count, g.created_at,
              COALESCE(bs.players, 0)  AS players,
              COALESCE(bs.total_wins, 0) AS total_wins,
              COALESCE(ch.challenges, 0) AS challenges
       FROM games g
       LEFT JOIN (
         SELECT game_id, COUNT(*)::int AS players, SUM(wins)::int AS total_wins
         FROM game_best_scores GROUP BY game_id
       ) bs ON bs.game_id = g.id
       LEFT JOIN (
         SELECT game_id, COUNT(*)::int AS challenges FROM game_challenges GROUP BY game_id
       ) ch ON ch.game_id = g.id
       WHERE g.deleted_at IS NULL
       ORDER BY g.category NULLS LAST, g.sort_order ASC, g.name ASC`
    );
    return NextResponse.json({ success: true, data: { games: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, createSchema);

    const slug = body.slug
      ? body.slug
      : await generateUniqueSlug("game", body.name, crypto.randomUUID());

    // Reject a duplicate explicit slug.
    if (body.slug) {
      const { rows: dup } = await db.query<{ id: string }>(
        `SELECT id FROM games WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
        [slug]
      );
      if (dup[0]) throw badRequest("A game with that slug already exists.");
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO games
         (slug, name, category, engine_key, tagline, description, long_description,
          cover_emoji, cover_image_url, reward_credits_per_win, reward_xp_per_win,
          reward_stars_per_win, play_cost_credits, play_cost_stars, max_score,
          min_play_seconds, sort_order, is_active, creator_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        slug, body.name, body.category, body.engineKey, body.tagline ?? null,
        body.description ?? null, body.longDescription ?? null, body.coverEmoji,
        body.coverImageUrl ?? null, body.rewardCreditsPerWin, body.rewardXpPerWin,
        body.rewardStarsPerWin, body.playCostCredits, body.playCostStars,
        body.maxScore ?? null, body.minPlaySeconds, body.sortOrder, body.isActive,
        auth.user.sub,
      ]
    );

    return NextResponse.json({ success: true, data: { id: rows[0].id, slug }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
