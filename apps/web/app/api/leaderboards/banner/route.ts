export const dynamic = 'force-dynamic';

/**
 * app/api/leaderboards/banner/route.ts
 *
 * GET /api/leaderboards/banner
 *
 * Returns the currently active sponsored leaderboard banner if one exists.
 * A banner is "current" when:
 *   - is_active = true
 *   - starts_at <= NOW()
 *   - ends_at   >= NOW()
 *
 * Each successful fetch increments the banner's impression counter by 1.
 * Returns null (with success: true) when no active banner is running.
 *
 * Authentication not required — this endpoint is public.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";

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
  impressions: number;
}

// ---------------------------------------------------------------------------
// GET /api/leaderboards/banner
// ---------------------------------------------------------------------------

export const GET = async () => {
  try {
    // Fetch and atomically increment the impression counter in one query.
    const { rows } = await db.query<BannerRow>(
      `UPDATE sponsored_leaderboard_banners
       SET impressions = impressions + 1
       WHERE id = (
         SELECT id
         FROM sponsored_leaderboard_banners
         WHERE is_active = true
           AND starts_at <= NOW()
           AND ends_at   >= NOW()
         ORDER BY starts_at DESC
         LIMIT 1
       )
       RETURNING id, sponsor_name, sponsor_logo_url, cta_text, cta_url,
                 starts_at, ends_at, impressions`
    );

    if (!rows[0]) {
      return NextResponse.json({
        success: true,
        data: { banner: null },
        error: null,
      });
    }

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
          impressions: row.impressions,
        },
      },
      error: null,
    }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (err) {
    return handleApiError(err);
  }
};
