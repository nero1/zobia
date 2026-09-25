export const dynamic = 'force-dynamic';

/**
 * app/api/admin/leaderboard-banners/[bannerId]/route.ts
 *
 * PATCH  /api/admin/leaderboard-banners/[bannerId]  — Update a sponsored banner.
 * DELETE /api/admin/leaderboard-banners/[bannerId]  — Delete a sponsored banner.
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PatchBannerSchema = z.object({
  isActive: z.boolean().optional(),
  sponsorName: z.string().min(1).max(200).optional(),
  sponsorLogoUrl: z.string().url().refine(u => !/^javascript:/i.test(u), "javascript: URLs are not allowed").nullable().optional(),
  ctaText: z.string().min(1).max(100).optional(),
  ctaUrl: z.string().url().refine(u => !/^javascript:/i.test(u), "javascript: URLs are not allowed").optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RouteParams {
  bannerId: string;
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/leaderboard-banners/[bannerId]
// ---------------------------------------------------------------------------

export const PATCH = withAdminAuth<RouteParams>(
  async (req: NextRequest, { params }) => {
    try {
      const { bannerId } = params;

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw badRequest("Invalid JSON body");
      }

      const parsed = PatchBannerSchema.safeParse(body);
      if (!parsed.success) {
        throw badRequest(parsed.error.errors.map((e) => e.message).join(", "));
      }

      const { isActive, sponsorName, sponsorLogoUrl, ctaText, ctaUrl, startsAt, endsAt } =
        parsed.data;

      const updates: Partial<typeof schema.sponsoredLeaderboardBanners.$inferInsert> = {};
      if (isActive !== undefined) updates.isActive = isActive;
      if (sponsorName !== undefined) updates.sponsorName = sponsorName;
      if (sponsorLogoUrl !== undefined) updates.sponsorLogoUrl = sponsorLogoUrl;
      if (ctaText !== undefined) updates.ctaText = ctaText;
      if (ctaUrl !== undefined) updates.ctaUrl = ctaUrl;
      if (startsAt !== undefined) updates.startsAt = new Date(startsAt);
      if (endsAt !== undefined) updates.endsAt = new Date(endsAt);

      if (Object.keys(updates).length === 0) {
        throw badRequest("No fields provided to update");
      }

      const orm = await getDb();
      const [row] = await orm
        .update(schema.sponsoredLeaderboardBanners)
        .set(updates)
        .where(eq(schema.sponsoredLeaderboardBanners.id, bannerId))
        .returning();

      if (!row) throw notFound("Banner not found");

      return NextResponse.json({
        success: true,
        data: {
          banner: {
            id: row.id,
            sponsorName: row.sponsorName,
            sponsorLogoUrl: row.sponsorLogoUrl,
            ctaText: row.ctaText,
            ctaUrl: row.ctaUrl,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            isActive: row.isActive,
            impressions: row.impressions,
            createdAt: row.createdAt,
          },
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/admin/leaderboard-banners/[bannerId]
// ---------------------------------------------------------------------------

export const DELETE = withAdminAuth<RouteParams>(
  async (_req: NextRequest, { params }) => {
    try {
      const { bannerId } = params;

      const orm = await getDb();
      const deleted = await orm
        .delete(schema.sponsoredLeaderboardBanners)
        .where(eq(schema.sponsoredLeaderboardBanners.id, bannerId))
        .returning({ id: schema.sponsoredLeaderboardBanners.id });

      if (deleted.length === 0) throw notFound("Banner not found");

      return NextResponse.json({
        success: true,
        data: null,
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
