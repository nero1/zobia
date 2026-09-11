export const dynamic = "force-dynamic";

/**
 * app/api/polls/[slug]/share/route.ts
 *
 * POST /api/polls/:slug/share — records a share (idempotent) and attempts a
 * reward-pot claim if the poll's creator funded one.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getPollIdBySlug, sharePoll } from "@/lib/polls/service";

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizVote);
    const pollId = await getPollIdBySlug(params.slug);
    if (!pollId) throw notFound("Poll not found");
    const result = await sharePoll(auth.user.sub, pollId);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
