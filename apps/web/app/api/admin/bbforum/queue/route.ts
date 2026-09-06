export const dynamic = "force-dynamic";

/**
 * app/api/admin/bbforum/queue/route.ts
 *
 * GET /api/admin/bbforum/queue — forum (boards/threads) moderation queue
 * (moderator or admin). Reuses the shared moderation_reports pipeline (same
 * table used by /api/admin/moderation and /api/admin/forum/queue for
 * Answers), filtered to reports targeting bbforum threads or posts.
 */

import { NextRequest, NextResponse } from "next/server";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

export const GET = withModeratorOrAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);

    const validStatuses = ["pending", "resolved", "escalated", "all"];
    const safeStatus = validStatuses.includes(status) ? status : "pending";

    const params: (string | number)[] = [limit + 1];
    let whereClause = `(r.reported_bb_thread_id IS NOT NULL OR r.reported_bb_post_id IS NOT NULL)`;

    if (safeStatus !== "all") {
      params.push(safeStatus);
      whereClause += ` AND r.status = $${params.length}`;
    }
    if (cursor) {
      params.push(cursor);
      whereClause += ` AND r.id < $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT
         r.id,
         r.reporter_id,
         reporter.username AS reporter_username,
         r.reported_bb_thread_id,
         r.reported_bb_post_id,
         t.title AS thread_title,
         p.body AS post_body,
         COALESCE(t.slug, pt.slug) AS thread_slug,
         COALESCE(t.author_id, p.author_id) AS content_author_id,
         r.report_type,
         r.description,
         r.status,
         r.ai_category,
         r.ai_confidence,
         r.ai_recommendation,
         r.created_at,
         r.resolved_at,
         r.resolved_by,
         resolver.username AS resolved_by_username,
         r.resolution_note,
         (SELECT ma.id FROM moderation_actions ma
          WHERE ma.report_id = r.id AND ma.reversed_at IS NULL
          ORDER BY ma.created_at DESC LIMIT 1) AS action_id
       FROM moderation_reports r
       LEFT JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN users resolver ON resolver.id = r.resolved_by
       LEFT JOIN bb_threads t ON t.id = r.reported_bb_thread_id
       LEFT JOIN bb_posts p ON p.id = r.reported_bb_post_id
       LEFT JOIN bb_threads pt ON pt.id = p.thread_id
       WHERE ${whereClause}
       ORDER BY r.ai_confidence DESC NULLS LAST, r.created_at DESC
       LIMIT $1`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1] as { id: string } | undefined)?.id ?? null : null;

    return NextResponse.json({ success: true, data: { items, hasMore, nextCursor }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
