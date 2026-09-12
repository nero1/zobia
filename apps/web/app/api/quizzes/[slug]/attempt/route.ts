export const dynamic = "force-dynamic";

/**
 * app/api/quizzes/[slug]/attempt/route.ts
 *
 * POST /api/quizzes/:slug/attempt — submit answers and get scored
 *   { answers: [{ questionId, selectedOptionIds }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getQuizIdBySlug, submitQuizAttempt } from "@/lib/quizzes/service";
import { db } from "@/lib/db";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";

const attemptSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        selectedOptionIds: z.array(z.string().uuid()).max(10),
      })
    )
    .min(1)
    .max(100),
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizVote);
    const quizId = await getQuizIdBySlug(params.slug);
    if (!quizId) throw notFound("Quiz not found");
    const body = await validateBody(req, attemptSchema);
    const result = await submitQuizAttempt({ userId: auth.user.sub, quizId, answers: body.answers });
    void triggerActivityQuestProgress(auth.user.sub, "quiz_complete", db);
    if (result.scorePercent >= 100) {
      void triggerActivityQuestProgress(auth.user.sub, "quiz_perfect", db);
    }
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
