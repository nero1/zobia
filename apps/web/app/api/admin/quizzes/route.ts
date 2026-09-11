export const dynamic = "force-dynamic";

/**
 * app/api/admin/quizzes/route.ts
 *
 * GET /api/admin/quizzes — monitoring table for all quizzes on the platform.
 *   ?status=active|closed|disabled|all&cursor=&limit=&q=
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
    const status = url.searchParams.get("status") ?? "all";
    const q = url.searchParams.get("q")?.trim();
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);

    const params: (string | number)[] = [];
    let where = "q.deleted_at IS NULL";
    if (status !== "all") {
      params.push(status);
      where += ` AND q.status = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (q.title ILIKE $${params.length} OR q.slug ILIKE $${params.length} OR u.username ILIKE $${params.length})`;
    }
    if (cursor) {
      params.push(cursor);
      where += ` AND q.created_at < $${params.length}`;
    }

    params.push(limit + 1);
    const { rows } = await db.query(
      `SELECT q.id, q.slug, q.title, q.status, q.attempt_count, q.share_count, q.created_at,
              u.id AS creator_id, u.username AS creator_username
       FROM quizzes q
       JOIN users u ON u.id = q.creator_id
       WHERE ${where}
       ORDER BY q.created_at DESC
       LIMIT $${params.length}`,
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
