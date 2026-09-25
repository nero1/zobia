export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/limits/route.ts
 *
 * GET — the caller's article/page quota for this blog (owner only), used by
 * the dashboard/editor "articles left" nag. Wraps lib/blogs/limits.ts's
 * getMaxBlogPosts (admin-configurable via manifest) — the client never
 * hardcodes plan limits.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { getMaxBlogPosts } from "@/lib/blogs/limits";
import { eq, and, isNull, count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    if (blog.owner_id !== auth.user.sub) throw forbidden("Only the blog owner can view this.");

    const orm = await getDb();
    const [userRow] = await orm
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    const plan = userRow?.plan ?? "free";

    const [countRow] = await orm
      .select({ count: count() })
      .from(schema.blogPosts)
      .where(and(eq(schema.blogPosts.blogId, blog.id), isNull(schema.blogPosts.deletedAt)));
    const used = countRow?.count ?? 0;
    const [maxPosts, plusMax, proMax, maxMax] = await Promise.all([
      getMaxBlogPosts(plan),
      getMaxBlogPosts("plus"),
      getMaxBlogPosts("pro"),
      getMaxBlogPosts("max"),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        plan,
        used,
        maxPosts,
        remaining: Math.max(0, maxPosts - used),
        planMaxPosts: { plus: plusMax, pro: proMax, max: maxMax },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
