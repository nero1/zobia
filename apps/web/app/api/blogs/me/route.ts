export const dynamic = "force-dynamic";

/**
 * app/api/blogs/me/route.ts
 *
 * GET /api/blogs/me — all of the caller's own blogs (personal + any owned
 * business account's), for the creator dashboard entry point and the
 * "Start a blog" CTA.
 *
 * Contract change (migration 0018 — blogs are no longer 1:1 with owner):
 * `data.blogs` is now an array. `data.blog` is kept alongside it, set to
 * the caller's first personal blog (or their first blog of any scope if
 * they have no personal one) purely for backward compatibility with
 * existing single-blog dashboard pages — new code should read `data.blogs`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogsByOwner } from "@/lib/blogs/repo";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blogs = await getBlogsByOwner(auth.user.sub);
    const primary = blogs.find((b) => !b.business_account_id) ?? blogs[0] ?? null;
    return NextResponse.json({ success: true, data: { blogs, blog: primary }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
