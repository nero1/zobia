export const dynamic = "force-dynamic";

/**
 * app/api/admin/wiki/route.ts
 *
 * GET /api/admin/wiki — monitoring table for all wikis on the platform.
 *   ?status=active|paused|suspended|banned|deactivated|all&cursor=&limit=&q=
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
    let where = "w.deleted_at IS NULL";
    if (status !== "all") {
      params.push(status);
      where += ` AND w.status = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (w.name ILIKE $${params.length} OR w.slug ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }
    if (cursor) {
      params.push(cursor);
      where += ` AND w.created_at < $${params.length}`;
    }

    params.push(limit + 1);
    const { rows } = await db.query(
      `SELECT w.id, w.slug, w.name, w.status, w.status_reason, w.contribute_policy, w.page_count,
              w.contributor_count, w.view_count, w.created_at, u.id AS owner_id, u.username AS owner_username
       FROM wikis w
       JOIN users u ON u.id = w.owner_id
       WHERE ${where}
       ORDER BY w.created_at DESC
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
