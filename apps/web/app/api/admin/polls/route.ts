export const dynamic = "force-dynamic";

/**
 * app/api/admin/polls/route.ts
 *
 * GET /api/admin/polls — monitoring table for all polls on the platform.
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
    let where = "p.deleted_at IS NULL";
    if (status !== "all") {
      params.push(status);
      where += ` AND p.status = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (p.title ILIKE $${params.length} OR p.slug ILIKE $${params.length} OR u.username ILIKE $${params.length})`;
    }
    if (cursor) {
      params.push(cursor);
      where += ` AND p.created_at < $${params.length}`;
    }

    params.push(limit + 1);
    const { rows } = await db.query(
      `SELECT p.id, p.slug, p.title, p.status, p.voter_count, p.share_count, p.created_at,
              u.id AS creator_id, u.username AS creator_username
       FROM polls p
       JOIN users u ON u.id = p.creator_id
       WHERE ${where}
       ORDER BY p.created_at DESC
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
