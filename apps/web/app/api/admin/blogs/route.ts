export const dynamic = "force-dynamic";

/**
 * app/api/admin/blogs/route.ts
 *
 * GET /api/admin/blogs — monitoring table for all blogs on the platform.
 *   ?status=active|paused|suspended|banned|deactivated|all&cursor=&limit=&q=
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, isNull, lt, or } from "drizzle-orm";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";

export const GET = withModeratorOrAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "all";
    const q = url.searchParams.get("q")?.trim();
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);

    const filters = [];
    if (status !== "all") {
      filters.push(eq(schema.blogs.status, status));
    }
    if (q) {
      const like = `%${q}%`;
      filters.push(
        or(
          ilike(schema.blogs.title, like),
          ilike(schema.blogs.slug, like),
          ilike(schema.users.username, like),
          ilike(schema.users.email, like)
        )
      );
    }
    if (cursor) {
      filters.push(lt(schema.blogs.createdAt, new Date(cursor)));
    }

    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.blogs.id,
        slug: schema.blogs.slug,
        title: schema.blogs.title,
        status: schema.blogs.status,
        status_reason: schema.blogs.statusReason,
        subscriber_count: schema.blogs.subscriberCount,
        post_count: schema.blogs.postCount,
        created_at: schema.blogs.createdAt,
        owner_id: schema.users.id,
        owner_username: schema.users.username,
      })
      .from(schema.blogs)
      .innerJoin(schema.users, eq(schema.users.id, schema.blogs.ownerId))
      .where(and(isNull(schema.blogs.deletedAt), ...filters))
      .orderBy(desc(schema.blogs.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return NextResponse.json({
      success: true,
      data: { items, hasMore, nextCursor: hasMore ? (items[items.length - 1] as { created_at: Date | string }).created_at : null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
