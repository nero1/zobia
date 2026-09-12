export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/view/route.ts
 *
 * POST /api/wiki/<slug>/view — records one wiki-level view. Callers dedupe
 * client-side via localStorage (same "at most once per viewer per session"
 * convention as blog post views — see lib/blogs/service.ts recordView) so
 * this never fires more than once per viewer per session, keeping DB writes
 * and Redis calls minimal.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug } from "@/lib/wiki/repo";
import { recordWikiView } from "@/lib/wiki/service";

export const POST = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiVote);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    await recordWikiView(wiki.id);
    return NextResponse.json({ success: true, data: { recorded: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
