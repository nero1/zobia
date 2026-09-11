export const dynamic = "force-dynamic";

/**
 * app/api/polls/[slug]/vote/route.ts
 *
 * POST /api/polls/:slug/vote — { optionIds: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getPollIdBySlug, votePoll } from "@/lib/polls/service";

const voteSchema = z.object({
  optionIds: z.array(z.string().uuid()).min(1).max(10),
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizVote);
    const pollId = await getPollIdBySlug(params.slug);
    if (!pollId) throw notFound("Poll not found");
    const body = await validateBody(req, voteSchema);
    const result = await votePoll(auth.user.sub, pollId, body.optionIds);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
