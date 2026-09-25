export const dynamic = "force-dynamic";

/**
 * app/api/admin/polls/route.ts
 *
 * GET /api/admin/polls — monitoring table for all polls on the platform.
 *   ?status=active|closed|disabled|all&cursor=&limit=&q=
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, isNull, lt, or } from "drizzle-orm";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
// NOTE: `polls` is defined in lib/db/schema.ts but omitted from the `schema`
// bundle object exported from there (a pre-existing gap, reported rather
// than silently added to the shared schema) — imported directly instead.
import { polls } from "@/lib/db/schema";

export const GET = withModeratorOrAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "all";
    const q = url.searchParams.get("q")?.trim();
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);

    const orm = await getDb();
    const whereClauses = [isNull(polls.deletedAt)];
    if (status !== "all") {
      whereClauses.push(eq(polls.status, status));
    }
    if (q) {
      const pattern = `%${q}%`;
      whereClauses.push(
        or(
          ilike(polls.title, pattern),
          ilike(polls.slug, pattern),
          ilike(schema.users.username, pattern)
        )!
      );
    }
    if (cursor) {
      whereClauses.push(lt(polls.createdAt, new Date(cursor)));
    }

    const rows = await orm
      .select({
        id: polls.id,
        slug: polls.slug,
        title: polls.title,
        status: polls.status,
        voter_count: polls.voterCount,
        share_count: polls.shareCount,
        created_at: polls.createdAt,
        creator_id: schema.users.id,
        creator_username: schema.users.username,
      })
      .from(polls)
      .innerJoin(schema.users, eq(schema.users.id, polls.creatorId))
      .where(and(...whereClauses))
      .orderBy(desc(polls.createdAt))
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
