export const dynamic = "force-dynamic";

/**
 * app/api/admin/quizzes/route.ts
 *
 * GET /api/admin/quizzes — monitoring table for all quizzes on the platform.
 *   ?status=active|closed|disabled|all&cursor=&limit=&q=
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, isNull, lt, or } from "drizzle-orm";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
// NOTE: `quizzes` is defined in lib/db/schema.ts but omitted from the
// `schema` bundle object exported from there (a pre-existing gap, reported
// rather than silently added to the shared schema) — imported directly.
import { quizzes } from "@/lib/db/schema";

export const GET = withModeratorOrAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "all";
    const q = url.searchParams.get("q")?.trim();
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);

    const orm = await getDb();
    const whereClauses = [isNull(quizzes.deletedAt)];
    if (status !== "all") {
      whereClauses.push(eq(quizzes.status, status));
    }
    if (q) {
      const pattern = `%${q}%`;
      whereClauses.push(
        or(
          ilike(quizzes.title, pattern),
          ilike(quizzes.slug, pattern),
          ilike(schema.users.username, pattern)
        )!
      );
    }
    if (cursor) {
      whereClauses.push(lt(quizzes.createdAt, new Date(cursor)));
    }

    const rows = await orm
      .select({
        id: quizzes.id,
        slug: quizzes.slug,
        title: quizzes.title,
        status: quizzes.status,
        attempt_count: quizzes.attemptCount,
        share_count: quizzes.shareCount,
        created_at: quizzes.createdAt,
        creator_id: schema.users.id,
        creator_username: schema.users.username,
      })
      .from(quizzes)
      .innerJoin(schema.users, eq(schema.users.id, quizzes.creatorId))
      .where(and(...whereClauses))
      .orderBy(desc(quizzes.createdAt))
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
