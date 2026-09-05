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
import { db } from "@/lib/db";

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    if (blog.owner_id !== auth.user.sub) throw forbidden("Only the blog owner can view this.");

    const { rows: userRows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 LIMIT 1`, [auth.user.sub]);
    const plan = userRows[0]?.plan ?? "free";

    const { rows: countRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM blog_posts WHERE blog_id = $1 AND deleted_at IS NULL`,
      [blog.id]
    );
    const used = parseInt(countRows[0]?.count ?? "0", 10);
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
