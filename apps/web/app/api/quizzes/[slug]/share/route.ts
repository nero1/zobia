export const dynamic = "force-dynamic";

/**
 * app/api/quizzes/[slug]/share/route.ts
 *
 * POST /api/quizzes/:slug/share — records a share (idempotent) and attempts
 * a reward-pot claim if the quiz's creator funded one.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getQuizIdBySlug, shareQuiz } from "@/lib/quizzes/service";

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizVote);
    const quizId = await getQuizIdBySlug(params.slug);
    if (!quizId) throw notFound("Quiz not found");
    const result = await shareQuiz(auth.user.sub, quizId);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
