export const dynamic = "force-dynamic";

/**
 * app/api/admin/forum/posts/route.ts
 *
 * GET /api/admin/forum/posts — paginated question/answer management table.
 *   ?type=question|answer (default question)&status=&cursor=&limit=
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
    const type = url.searchParams.get("type") === "answer" ? "answer" : "question";
    const status = url.searchParams.get("status") ?? "all";
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);

    const params: (string | number)[] = [limit + 1];
    let whereClause = "1=1";
    if (status !== "all") {
      params.push(status);
      whereClause += ` AND t.status = $${params.length}`;
    }
    if (cursor) {
      params.push(cursor);
      whereClause += ` AND t.created_at < $${params.length}`;
    }

    if (type === "question") {
      const { rows } = await db.query(
        `SELECT t.id, t.title, t.body, t.status, t.vote_score, t.answer_count,
                t.favorite_count, t.is_locked, t.created_at, u.username AS author_username
         FROM forum_questions t
         JOIN users u ON u.id = t.author_id
         WHERE ${whereClause}
         ORDER BY t.created_at DESC
         LIMIT $1`,
        params
      );
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return NextResponse.json({
        success: true,
        data: { items, hasMore, nextCursor: hasMore ? (items[items.length - 1] as { created_at: string }).created_at : null },
        error: null,
      });
    }

    const { rows } = await db.query(
      `SELECT t.id, t.question_id, t.body, t.status, t.vote_score, t.depth, t.created_at,
              u.username AS author_username
       FROM forum_answers t
       JOIN users u ON u.id = t.author_id
       WHERE ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $1`,
      params
    );
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return NextResponse.json({
      success: true,
      data: { items, hasMore, nextCursor: hasMore ? (items[items.length - 1] as { created_at: string }).created_at : null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
