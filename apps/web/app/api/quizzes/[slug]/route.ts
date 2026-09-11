export const dynamic = "force-dynamic";

/**
 * app/api/quizzes/[slug]/route.ts
 *
 * GET    /api/quizzes/:slug — quiz detail. Correct answers are only ever
 *        included when the viewer is the quiz's creator (?includeAnswers=1),
 *        never revealed to a taker before they submit an attempt.
 * PATCH  /api/quizzes/:slug — creator/moderator: { status: "active"|"closed"|"disabled" }
 * DELETE /api/quizzes/:slug — creator/moderator: soft delete
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getQuizBySlug, recordQuizView, assertQuizOwnerOrAdmin, setQuizStatus, deleteQuiz } from "@/lib/quizzes/service";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";

const patchSchema = z.object({
  status: z.enum(["active", "closed", "disabled"]),
});

export const GET = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const includeAnswers = req.nextUrl.searchParams.get("includeAnswers") === "1";
    const quiz = await getQuizBySlug(params.slug, auth.user.sub, includeAnswers);
    if (!quiz) throw notFound("Quiz not found");
    void recordQuizView(quiz.id);
    return NextResponse.json({ success: true, data: quiz, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const quiz = await getQuizBySlug(params.slug);
    if (!quiz) throw notFound("Quiz not found");
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await assertQuizOwnerOrAdmin(quiz.id, auth.user.sub, isMod);
    const body = await validateBody(req, patchSchema);
    await setQuizStatus(quiz.id, body.status);
    return NextResponse.json({ success: true, data: { status: body.status }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const quiz = await getQuizBySlug(params.slug);
    if (!quiz) throw notFound("Quiz not found");
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await assertQuizOwnerOrAdmin(quiz.id, auth.user.sub, isMod);
    await deleteQuiz(quiz.id);
    return NextResponse.json({ success: true, data: { id: quiz.id }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
