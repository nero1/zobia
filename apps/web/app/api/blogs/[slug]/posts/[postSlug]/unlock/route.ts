export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/unlock/route.ts
 *
 * POST — spend Credits to unlock a paywalled article for the caller.
 * Idempotent: re-unlocking an already-unlocked post returns 200 without charging again.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogPostBySlug } from "@/lib/blogs/repo";
import { unlockPost } from "@/lib/blogs/service";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

export const POST = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post || post.status !== "published") throw notFound("Post not found");

    const orm = await getDb();
    const [userRow] = await orm
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    const result = await unlockPost(post.id, auth.user.sub, userRow?.plan ?? "free");
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
