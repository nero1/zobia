export const dynamic = "force-dynamic";

/**
 * app/api/admin/forum/queue/route.ts
 *
 * GET /api/admin/forum/queue — Forum moderation queue (moderator or admin).
 *
 * Reuses the existing moderation_reports pipeline (§ same table used by
 * /api/admin/moderation), filtered to reports targeting forum questions or
 * answers. Ordered by AI confidence (desc) then recency, matching the
 * general moderation queue's convention.
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
    let whereClause = `(r.reported_forum_question_id IS NOT NULL OR r.reported_forum_answer_id IS NOT NULL)`;

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
      reporter_username: string | null;
      reported_forum_question_id: string | null;
      reported_forum_answer_id: string | null;
      question_title: string | null;
      answer_body: string | null;
      report_type: string;
      description: string | null;
      status: string;
      ai_category: string | null;
      ai_confidence: number | null;
      ai_recommendation: string | null;
      created_at: string;
      resolved_at: string | null;
    }>(
      `SELECT
         r.id,
         r.reporter_id,
         reporter.username AS reporter_username,
         r.reported_forum_question_id,
         r.reported_forum_answer_id,
         q.title AS question_title,
         a.body AS answer_body,
         r.report_type,
         r.description,
         r.status,
         r.ai_category,
         r.ai_confidence,
         r.ai_recommendation,
         r.created_at,
         r.resolved_at
       FROM moderation_reports r
       LEFT JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN forum_questions q ON q.id = r.reported_forum_question_id
       LEFT JOIN forum_answers a ON a.id = r.reported_forum_answer_id
       WHERE ${whereClause}
       ORDER BY r.ai_confidence DESC NULLS LAST, r.created_at DESC
       LIMIT $1`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return NextResponse.json({
      success: true,
      data: { items, hasMore, nextCursor },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
