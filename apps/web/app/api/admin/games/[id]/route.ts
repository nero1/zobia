export const dynamic = "force-dynamic";

/**
 * app/api/admin/games/<id>
 *
 * PUT    — update a game's cover page, rewards, play cost and active flags.
 *          Slug changes record a redirect from the old slug.
 * DELETE — soft-delete a game (removed from the directory and public pages).
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, type SqlParam } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { recordSlugRedirect } from "@/lib/slug";
import { GAME_CATEGORIES } from "@zobia/types";

const categoryEnum = z.enum(GAME_CATEGORIES as unknown as [string, ...string[]]);

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  category: categoryEnum.optional(),
  engineKey: z.string().min(1).max(60).optional(),
  tagline: z.string().max(160).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  longDescription: z.string().max(8000).nullable().optional(),
  coverEmoji: z.string().min(1).max(8).optional(),
  coverImageUrl: z.string().url().max(500).nullable().optional(),
  rewardCreditsPerWin: z.number().int().min(0).optional(),
  rewardXpPerWin: z.number().int().min(0).optional(),
  rewardStarsPerWin: z.number().int().min(0).optional(),
  playCostCredits: z.number().int().min(0).optional(),
  playCostStars: z.number().int().min(0).optional(),
  maxScore: z.number().int().min(0).nullable().optional(),
  minPlaySeconds: z.number().int().min(0).max(86400).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

// Maps camelCase body keys → snake_case columns.
const COLUMN_MAP: Record<string, string> = {
  name: "name",
  category: "category",
  engineKey: "engine_key",
  tagline: "tagline",
  description: "description",
  longDescription: "long_description",
  coverEmoji: "cover_emoji",
  coverImageUrl: "cover_image_url",
  rewardCreditsPerWin: "reward_credits_per_win",
  rewardXpPerWin: "reward_xp_per_win",
  rewardStarsPerWin: "reward_stars_per_win",
  playCostCredits: "play_cost_credits",
  playCostStars: "play_cost_stars",
  maxScore: "max_score",
  minPlaySeconds: "min_play_seconds",
  sortOrder: "sort_order",
  isActive: "is_active",
  isPublic: "is_public",
};

export const PUT = withAdminAuth(
  async (req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const body = await validateBody(req, updateSchema);

      const { rows: existingRows } = await db.query<{ slug: string }>(
        `SELECT slug FROM games WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [params.id]
      );
      const existing = existingRows[0];
      if (!existing) throw notFound("Game not found.");

      // Handle slug change (uniqueness + redirect from the old slug).
      let newSlug: string | null = null;
      if (body.slug && body.slug !== existing.slug) {
        const { rows: dup } = await db.query<{ id: string }>(
          `SELECT id FROM games WHERE slug = $1 AND deleted_at IS NULL AND id <> $2 LIMIT 1`,
          [body.slug, params.id]
        );
        if (dup[0]) throw badRequest("A game with that slug already exists.");
        newSlug = body.slug;
      }

      const sets: string[] = [];
      const values: SqlParam[] = [];
      let i = 1;
      for (const [key, col] of Object.entries(COLUMN_MAP)) {
        if (key in body && body[key as keyof typeof body] !== undefined) {
          sets.push(`${col} = $${i++}`);
          values.push(body[key as keyof typeof body] as SqlParam);
        }
      }
      if (newSlug) {
        sets.push(`slug = $${i++}`);
        values.push(newSlug);
      }
      if (sets.length === 0) throw badRequest("No fields to update.");

      sets.push(`updated_at = NOW()`);
      values.push(params.id);
      await db.query(`UPDATE games SET ${sets.join(", ")} WHERE id = $${i}`, values);

      if (newSlug) {
        await recordSlugRedirect("game", existing.slug, params.id, newSlug).catch(() => {});
      }

      return NextResponse.json({ success: true, data: { id: params.id, slug: newSlug ?? existing.slug }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

export const DELETE = withAdminAuth(
  async (_req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const { rowCount } = await db.query(
        `UPDATE games SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [params.id]
      );
      if (!rowCount) throw notFound("Game not found.");
      return NextResponse.json({ success: true, data: { deleted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
