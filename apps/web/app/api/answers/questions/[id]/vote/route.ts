export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/[id]/vote/route.ts
 *
 * POST /api/answers/questions/:id/vote — { value: -1 | 1 }
 * Voting the same direction again toggles the vote off.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { castVote } from "@/lib/forum/service";

const voteSchema = z.object({ value: z.union([z.literal(-1), z.literal(1)]) });

export const POST = withAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumVote);
    const body = await validateBody(req, voteSchema);
    const result = await castVote("question", id, auth.user.sub, body.value);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
