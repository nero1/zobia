export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/[id]/answers/[answerId]/thread/route.ts
 *
 * GET /api/answers/questions/:id/answers/:answerId/thread
 *
 * Lazy-loads the full reply subtree rooted at :answerId (bounded by
 * MAX_ANSWER_DEPTH via a recursive CTE) — used for the "View N more
 * replies" / "Continue this thread" interaction so the initial question
 * page load only eagerly fetches 3 replies per top-level answer.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getAnswerThread } from "@/lib/forum/repo";

export const GET = withAuth<{ id: string; answerId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { answerId } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const thread = await getAnswerThread(auth.user.sub, answerId);
    return NextResponse.json({ success: true, data: { thread }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
