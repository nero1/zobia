export const dynamic = "force-dynamic";

/**
 * app/api/admin/wiki/route.ts
 *
 * GET /api/admin/wiki — monitoring table for all wikis on the platform.
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

    const orm = await getDb();
    const whereClauses = [isNull(schema.wikis.deletedAt)];
    if (status !== "all") {
      whereClauses.push(eq(schema.wikis.status, status));
    }
    if (q) {
      const pattern = `%${q}%`;
      whereClauses.push(
        or(
          ilike(schema.wikis.name, pattern),
          ilike(schema.wikis.slug, pattern),
          ilike(schema.users.username, pattern),
          ilike(schema.users.email, pattern)
        )!
      );
    }
    if (cursor) {
      whereClauses.push(lt(schema.wikis.createdAt, new Date(cursor)));
    }

    const rows = await orm
      .select({
        id: schema.wikis.id,
        slug: schema.wikis.slug,
        name: schema.wikis.name,
        status: schema.wikis.status,
        status_reason: schema.wikis.statusReason,
        contribute_policy: schema.wikis.contributePolicy,
        page_count: schema.wikis.pageCount,
        contributor_count: schema.wikis.contributorCount,
        view_count: schema.wikis.viewCount,
        created_at: schema.wikis.createdAt,
        owner_id: schema.users.id,
        owner_username: schema.users.username,
      })
      .from(schema.wikis)
      .innerJoin(schema.users, eq(schema.users.id, schema.wikis.ownerId))
      .where(and(...whereClauses))
      .orderBy(desc(schema.wikis.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return NextResponse.json({
      success: true,
      data: { items, hasMore, nextCursor: hasMore ? (items[items.length - 1] as { created_at: Date }).created_at : null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
