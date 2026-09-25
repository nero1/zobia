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
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { games } from "@/lib/db/schema";
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

export const PUT = withAdminAuth(
  async (req: NextRequest, { params }: { params: { id: string }; auth: any }) => {
    try {
      const body = await validateBody(req, updateSchema);
      const orm = await getDb();

      const [existing] = await orm
        .select({ slug: games.slug })
        .from(games)
        .where(and(eq(games.id, params.id), isNull(games.deletedAt)))
        .limit(1);
      if (!existing) throw notFound("Game not found.");

      // Handle slug change (uniqueness + redirect from the old slug).
      let newSlug: string | null = null;
      if (body.slug && body.slug !== existing.slug) {
        const [dup] = await orm
          .select({ id: games.id })
          .from(games)
          .where(
            and(
              eq(games.slug, body.slug),
              isNull(games.deletedAt),
              ne(games.id, params.id)
            )
          )
          .limit(1);
        if (dup) throw badRequest("A game with that slug already exists.");
        newSlug = body.slug;
      }

      const updates: Partial<typeof games.$inferInsert> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.category !== undefined) updates.category = body.category;
      if (body.engineKey !== undefined) updates.engineKey = body.engineKey;
      if (body.tagline !== undefined) updates.tagline = body.tagline;
      if (body.description !== undefined) updates.description = body.description;
      if (body.longDescription !== undefined) updates.longDescription = body.longDescription;
      if (body.coverEmoji !== undefined) updates.coverEmoji = body.coverEmoji;
      if (body.coverImageUrl !== undefined) updates.coverImageUrl = body.coverImageUrl;
      if (body.rewardCreditsPerWin !== undefined) updates.rewardCreditsPerWin = body.rewardCreditsPerWin;
      if (body.rewardXpPerWin !== undefined) updates.rewardXpPerWin = body.rewardXpPerWin;
      if (body.rewardStarsPerWin !== undefined) updates.rewardStarsPerWin = body.rewardStarsPerWin;
      if (body.playCostCredits !== undefined) updates.playCostCredits = body.playCostCredits;
      if (body.playCostStars !== undefined) updates.playCostStars = body.playCostStars;
      if (body.maxScore !== undefined) updates.maxScore = body.maxScore === null ? null : BigInt(body.maxScore);
      if (body.minPlaySeconds !== undefined) updates.minPlaySeconds = body.minPlaySeconds;
      if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
      if (body.isActive !== undefined) updates.isActive = body.isActive;
      if (body.isPublic !== undefined) updates.isPublic = body.isPublic;
      if (newSlug) updates.slug = newSlug;

      if (Object.keys(updates).length === 0) throw badRequest("No fields to update.");
      updates.updatedAt = new Date();

      await orm.update(games).set(updates).where(eq(games.id, params.id));

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
      const orm = await getDb();
      const result = await orm
        .update(games)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(games.id, params.id), isNull(games.deletedAt)))
        .returning({ id: games.id });
      if (result.length === 0) throw notFound("Game not found.");
      return NextResponse.json({ success: true, data: { deleted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
