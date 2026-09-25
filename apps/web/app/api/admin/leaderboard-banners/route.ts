export const dynamic = 'force-dynamic';

/**
 * app/api/admin/leaderboard-banners/route.ts
 *
 * GET  /api/admin/leaderboard-banners  — List all sponsored leaderboard banners.
 * POST /api/admin/leaderboard-banners  — Create a new sponsored banner.
 *
 * Admin only. Requires admin session.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateBannerSchema = z.object({
  sponsorName: z.string().min(1).max(200),
  sponsorLogoUrl: z.string().url().refine(u => !/^javascript:/i.test(u), "javascript: URLs are not allowed").optional().nullable(),
  ctaText: z.string().min(1).max(100),
  ctaUrl: z.string().url().refine(u => !/^javascript:/i.test(u), "javascript: URLs are not allowed"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
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

function formatBanner(row: BannerRow) {
  return {
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
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/leaderboard-banners
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.sponsoredLeaderboardBanners.id,
        sponsor_name: schema.sponsoredLeaderboardBanners.sponsorName,
        sponsor_logo_url: schema.sponsoredLeaderboardBanners.sponsorLogoUrl,
        cta_text: schema.sponsoredLeaderboardBanners.ctaText,
        cta_url: schema.sponsoredLeaderboardBanners.ctaUrl,
        starts_at: schema.sponsoredLeaderboardBanners.startsAt,
        ends_at: schema.sponsoredLeaderboardBanners.endsAt,
        is_active: schema.sponsoredLeaderboardBanners.isActive,
        impressions: schema.sponsoredLeaderboardBanners.impressions,
        created_at: schema.sponsoredLeaderboardBanners.createdAt,
      })
      .from(schema.sponsoredLeaderboardBanners)
      .orderBy(desc(schema.sponsoredLeaderboardBanners.createdAt));

    return NextResponse.json({
      success: true,
      data: { banners: (rows as unknown as BannerRow[]).map(formatBanner) },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/leaderboard-banners
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }

    const parsed = CreateBannerSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest(parsed.error.errors.map((e) => e.message).join(", "));
    }

    const { sponsorName, sponsorLogoUrl, ctaText, ctaUrl, startsAt, endsAt } =
      parsed.data;

    if (new Date(endsAt) <= new Date(startsAt)) {
      throw badRequest("ends_at must be after starts_at");
    }

    const orm = await getDb();
    const [row] = await orm
      .insert(schema.sponsoredLeaderboardBanners)
      .values({
        sponsorName,
        sponsorLogoUrl: sponsorLogoUrl ?? null,
        ctaText,
        ctaUrl,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        isActive: false,
        impressions: 0,
      })
      .returning({
        id: schema.sponsoredLeaderboardBanners.id,
        sponsor_name: schema.sponsoredLeaderboardBanners.sponsorName,
        sponsor_logo_url: schema.sponsoredLeaderboardBanners.sponsorLogoUrl,
        cta_text: schema.sponsoredLeaderboardBanners.ctaText,
        cta_url: schema.sponsoredLeaderboardBanners.ctaUrl,
        starts_at: schema.sponsoredLeaderboardBanners.startsAt,
        ends_at: schema.sponsoredLeaderboardBanners.endsAt,
        is_active: schema.sponsoredLeaderboardBanners.isActive,
        impressions: schema.sponsoredLeaderboardBanners.impressions,
        created_at: schema.sponsoredLeaderboardBanners.createdAt,
      });

    return NextResponse.json(
      {
        success: true,
        data: { banner: formatBanner(row as unknown as BannerRow) },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
