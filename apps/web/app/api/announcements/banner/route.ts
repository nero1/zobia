export const dynamic = 'force-dynamic';

/**
 * app/api/announcements/banner/route.ts
 *
 * GET /api/announcements/banner
 *   Returns the next announcement banner for the authenticated user using
 *   server-side rotation tracking (serial or random mode).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getManifestValue } from "@/lib/manifest";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface BannerRow {
  id: string;
  content: string;
  content_type: string;
  display_order: number;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const now = new Date().toISOString();

    const { rows: userRows } = await db.query<{ plan: string }>(
      `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const user = userRows[0];
    if (!user) return NextResponse.json({ success: true, data: { banner: null }, error: null });

    const { rows: banners } = await db.query<BannerRow>(
      `SELECT id, content, content_type, display_order
       FROM announcement_banners
       WHERE is_active = TRUE
         AND (starts_at IS NULL OR starts_at <= $1)
         AND (ends_at IS NULL OR ends_at >= $1)
         AND $2 = ANY(target_plans)
       ORDER BY display_order ASC, created_at ASC`,
      [now, user.plan]
    );

    if (banners.length === 0) {
      return NextResponse.json({ success: true, data: { banner: null }, error: null });
    }

    const displayMode = (await getManifestValue("announcement_banner_mode"))?.replace(/"/g, "") ?? "serial";

    const { rows: rotationRows } = await db.query<{ last_shown_id: string }>(
      `SELECT last_shown_id FROM user_announcement_rotation
       WHERE user_id = $1 AND content_type = 'banner' LIMIT 1`,
      [userId]
    );
    const lastShownId = rotationRows[0]?.last_shown_id ?? null;

    let selected: BannerRow;

    if (displayMode === "random") {
      selected = banners[Math.floor(Math.random() * banners.length)];
    } else {
      if (!lastShownId) {
        selected = banners[0];
      } else {
        const lastIdx = banners.findIndex((b) => b.id === lastShownId);
        selected = lastIdx === -1 || lastIdx === banners.length - 1
          ? banners[0]
          : banners[lastIdx + 1];
      }
    }

    await db.query(
      `INSERT INTO user_announcement_rotation (user_id, content_type, last_shown_id, last_shown_at)
       VALUES ($1, 'banner', $2, NOW())
       ON CONFLICT (user_id, content_type)
       DO UPDATE SET last_shown_id = EXCLUDED.last_shown_id, last_shown_at = EXCLUDED.last_shown_at`,
      [userId, selected.id]
    );

    return NextResponse.json({
      success: true,
      data: {
        banner: {
          id: selected.id,
          content: selected.content,
          contentType: selected.content_type,
        },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
