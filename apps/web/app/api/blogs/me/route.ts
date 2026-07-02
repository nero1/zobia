export const dynamic = "force-dynamic";

/**
 * app/api/blogs/me/route.ts
 *
 * GET /api/blogs/me — the caller's own blog (or null), for the creator
 * dashboard entry point and the "Start a blog" CTA.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogByOwner } from "@/lib/blogs/repo";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogByOwner(auth.user.sub);
    return NextResponse.json({ success: true, data: { blog }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
