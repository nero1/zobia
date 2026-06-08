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
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { db, SqlParam } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PatchBannerSchema = z.object({
  isActive: z.boolean().optional(),
  sponsorName: z.string().min(1).max(200).optional(),
  sponsorLogoUrl: z.string().url().nullable().optional(),
  ctaText: z.string().min(1).max(100).optional(),
  ctaUrl: z.string().url().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BannerRow {
  id: string;
  sponsor_name: string;
  sponsor_logo_url: string | null;
  cta_text: string;
  cta_url: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  impressions: number;
  created_at: string;
}

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

      const updates: string[] = [];
      const values: SqlParam[] = [bannerId];
      let idx = 2;

      const { isActive, sponsorName, sponsorLogoUrl, ctaText, ctaUrl, startsAt, endsAt } =
        parsed.data;

      if (isActive !== undefined) { updates.push(`is_active = $${idx++}`); values.push(isActive); }
      if (sponsorName !== undefined) { updates.push(`sponsor_name = $${idx++}`); values.push(sponsorName); }
      if (sponsorLogoUrl !== undefined) { updates.push(`sponsor_logo_url = $${idx++}`); values.push(sponsorLogoUrl); }
      if (ctaText !== undefined) { updates.push(`cta_text = $${idx++}`); values.push(ctaText); }
      if (ctaUrl !== undefined) { updates.push(`cta_url = $${idx++}`); values.push(ctaUrl); }
      if (startsAt !== undefined) { updates.push(`starts_at = $${idx++}`); values.push(startsAt); }
      if (endsAt !== undefined) { updates.push(`ends_at = $${idx++}`); values.push(endsAt); }

      if (updates.length === 0) {
        throw badRequest("No fields provided to update");
      }

      const { rows } = await db.query<BannerRow>(
        `UPDATE sponsored_leaderboard_banners
         SET ${updates.join(", ")}
         WHERE id = $1
         RETURNING id, sponsor_name, sponsor_logo_url, cta_text, cta_url,
                   starts_at, ends_at, is_active, impressions, created_at`,
        values
      );

      if (!rows[0]) throw notFound("Banner not found");

      const row = rows[0];
      return NextResponse.json({
        success: true,
        data: {
          banner: {
            id: row.id,
            sponsorName: row.sponsor_name,
            sponsorLogoUrl: row.sponsor_logo_url,
            ctaText: row.cta_text,
            ctaUrl: row.cta_url,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            isActive: row.is_active,
            impressions: row.impressions,
            createdAt: row.created_at,
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

      const { rowCount } = await db.query(
        `DELETE FROM sponsored_leaderboard_banners WHERE id = $1`,
        [bannerId]
      );

      if (!rowCount) throw notFound("Banner not found");

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
