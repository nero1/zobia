export const dynamic = 'force-dynamic';

/**
 * app/api/announcements/modal/route.ts
 *
 * GET /api/announcements/modal
 *   Returns the next announcement modal for the authenticated user using
 *   server-side rotation tracking (serial or random mode).
 *
 * The rotation cursor is stored in user_announcement_rotation so it persists
 * across devices and reinstalls.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getManifestValue } from "@/lib/manifest";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface ModalRow {
  id: string;
  title: string;
  content: string;
  content_type: string;
  display_order: number;
}

interface UserContext {
  plan: string;
  role: string | null;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const now = new Date().toISOString();

    // Fetch user plan and role for audience filtering
    const { rows: userRows } = await db.query<UserContext>(
      `SELECT COALESCE(plan, 'free') AS plan, role
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const user = userRows[0];
    if (!user) return NextResponse.json({ success: true, data: { modal: null }, error: null });

    // Fetch all active, scheduled modals whose audience includes this user's plan
    // OR whose audience includes this user's role (empty target_plans/target_roles
    // means "show to everyone" for that dimension).
    const { rows: modals } = await db.query<ModalRow>(
      `SELECT id, title, content, content_type, display_order
       FROM announcement_modals
       WHERE is_active = TRUE
         AND (starts_at IS NULL OR starts_at <= $1)
         AND (ends_at IS NULL OR ends_at >= $1)
         AND (
           cardinality(target_plans) = 0 OR $2 = ANY(target_plans)
         )
         AND (
           cardinality(target_roles) = 0
           OR ($3::text IS NOT NULL AND $3::text = ANY(target_roles))
         )
       ORDER BY display_order ASC, created_at ASC`,
      [now, user.plan, user.role ?? null]
    );

    if (modals.length === 0) {
      return NextResponse.json({ success: true, data: { modal: null }, error: null });
    }

    // Read display mode from x_manifest
    const displayMode = (await getManifestValue("announcement_modal_display_mode"))?.replace(/"/g, "") ?? "serial";

    // Read last-shown rotation cursor for this user
    const { rows: rotationRows } = await db.query<{ last_shown_id: string }>(
      `SELECT last_shown_id FROM user_announcement_rotation
       WHERE user_id = $1 AND content_type = 'modal' LIMIT 1`,
      [userId]
    );
    const lastShownId = rotationRows[0]?.last_shown_id ?? null;

    let selected: ModalRow;

    if (displayMode === "random") {
      selected = modals[Math.floor(Math.random() * modals.length)];
    } else {
      // Serial: pick the next in display_order after last_shown_id; wrap around
      if (!lastShownId) {
        selected = modals[0];
      } else {
        const lastIdx = modals.findIndex((m) => m.id === lastShownId);
        selected = lastIdx === -1 || lastIdx === modals.length - 1
          ? modals[0]
          : modals[lastIdx + 1];
      }
    }

    // Upsert rotation cursor
    await db.query(
      `INSERT INTO user_announcement_rotation (user_id, content_type, last_shown_id, last_shown_at)
       VALUES ($1, 'modal', $2, NOW())
       ON CONFLICT (user_id, content_type)
       DO UPDATE SET last_shown_id = EXCLUDED.last_shown_id, last_shown_at = EXCLUDED.last_shown_at`,
      [userId, selected.id]
    );

    return NextResponse.json({
      success: true,
      data: {
        modal: {
          id: selected.id,
          title: selected.title,
          content: selected.content,
          contentType: selected.content_type,
        },
      },
      error: null,
    }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
  } catch (err) {
    return handleApiError(err);
  }
});
