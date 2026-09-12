export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/share/route.ts
 *
 * POST /api/wiki/<slug>/share — records a share (idempotent per user) and
 * attempts a reward-pot claim, same mechanic as Polls/Quizzes sharing.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug } from "@/lib/wiki/repo";
import { shareWiki } from "@/lib/wiki/service";

export const POST = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiVote);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const result = await shareWiki(wiki.id, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
