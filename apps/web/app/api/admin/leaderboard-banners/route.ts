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
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateBannerSchema = z.object({
  sponsorName: z.string().min(1).max(200),
  sponsorLogoUrl: z.string().url().optional().nullable(),
  ctaText: z.string().min(1).max(100),
  ctaUrl: z.string().url(),
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
    const { rows } = await db.query<BannerRow>(
      `SELECT id, sponsor_name, sponsor_logo_url, cta_text, cta_url,
              starts_at, ends_at, is_active, impressions, created_at
       FROM sponsored_leaderboard_banners
       ORDER BY created_at DESC`
    );

    return NextResponse.json({
      success: true,
      data: { banners: rows.map(formatBanner) },
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

    const { rows } = await db.query<BannerRow>(
      `INSERT INTO sponsored_leaderboard_banners
         (sponsor_name, sponsor_logo_url, cta_text, cta_url, starts_at, ends_at, is_active, impressions)
       VALUES ($1, $2, $3, $4, $5, $6, false, 0)
       RETURNING id, sponsor_name, sponsor_logo_url, cta_text, cta_url,
                 starts_at, ends_at, is_active, impressions, created_at`,
      [sponsorName, sponsorLogoUrl ?? null, ctaText, ctaUrl, startsAt, endsAt]
    );

    return NextResponse.json(
      {
        success: true,
        data: { banner: formatBanner(rows[0]) },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
