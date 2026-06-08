export const dynamic = 'force-dynamic';

/**
 * app/api/admin/moderation/route.ts
 *
 * GET /api/admin/moderation — Moderation queue (admin only).
 *
 * Returns pending reports ordered by AI confidence (desc) and severity
 * derived from the AI recommendation tier. Supports pagination via
 * cursor (last report ID) and optional status filter.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Severity ordering for recommendations
// ---------------------------------------------------------------------------

/** SQL CASE expression that maps AI recommendation to a numeric severity tier. */
const SEVERITY_CASE = `
  CASE ai_recommendation
    WHEN 'ban_user'       THEN 5
    WHEN 'suspend_user'   THEN 4
    WHEN 'remove_content' THEN 3
    WHEN 'warn'           THEN 2
    WHEN 'dismiss'        THEN 1
    ELSE 0
  END
`;

// ---------------------------------------------------------------------------
// GET /api/admin/moderation
// ---------------------------------------------------------------------------

/**
 * Return the moderation queue for admins.
 *
 * Ordered by: severity tier (desc), AI confidence (desc), created_at (desc).
 * Supports pagination via `cursor` (opaque last-seen report ID) and
 * optional `status` filter (default: pending).
 *
 * @returns Paginated list of reports with AI metadata
 */
export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);

    const validStatuses = ["pending", "resolved", "dismissed", "all"];
    const safeStatus = validStatuses.includes(status) ? status : "pending";

    const params: (string | number)[] = [limit + 1];
    let whereClause = `r.deleted_at IS NULL`;

    if (safeStatus !== "all") {
      params.push(safeStatus);
      whereClause += ` AND r.status = $${params.length}`;
    }

    if (cursor) {
      params.push(cursor);
      whereClause += ` AND r.id < $${params.length}`;
    }

    const { rows } = await db.query<{
      id: string;
      reporter_id: string;
      reporter_username: string;
      reported_user_id: string | null;
      reported_user_username: string | null;
      reported_message_id: string | null;
      reported_room_id: string | null;
      reported_guild_id: string | null;
      report_type: string;
      description: string | null;
      status: string;
      ai_category: string | null;
      ai_confidence: number | null;
      ai_recommendation: string | null;
      ai_provider: string | null;
      severity: number;
      created_at: string;
      resolved_at: string | null;
    }>(
      `SELECT
         r.id,
         r.reporter_id,
         reporter.username    AS reporter_username,
         r.reported_user_id,
         reported.username    AS reported_user_username,
         r.reported_message_id,
         r.reported_room_id,
         r.reported_guild_id,
         r.report_type,
         r.description,
         r.status,
         r.ai_category,
         r.ai_confidence,
         r.ai_recommendation,
         r.ai_provider,
         (${SEVERITY_CASE}) AS severity,
         r.created_at,
         r.resolved_at
       FROM moderation_reports r
       LEFT JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN users reported ON reported.id  = r.reported_user_id
       WHERE ${whereClause}
       ORDER BY severity DESC, r.ai_confidence DESC NULLS LAST, r.created_at DESC
       LIMIT $1`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return NextResponse.json({
      items,
      pagination: {
        has_more: hasMore,
        next_cursor: nextCursor,
        limit,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
