export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/quizzes/[quizId]/route.ts
 *
 * GET    — a quiz's questions for taking it (members, moderators, creator).
 *          Correct answers are NEVER included; the caller's own attempt
 *          (score/passed) is returned if they already submitted one.
 * DELETE — deactivate a quiz (creator/staff).
 */

import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";

export const GET = withAuth<{ roomId: string; quizId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    const quizId = assertUuid(params.quizId, "Quiz");
    const orm = await getDb();

    const [quiz] = await orm
      .select({
        id: schema.classroomQuizzes.id,
        title: schema.classroomQuizzes.title,
        description: schema.classroomQuizzes.description,
        xp_reward: schema.classroomQuizzes.xpReward,
        pass_score: schema.classroomQuizzes.passScore,
      })
      .from(schema.classroomQuizzes)
      .where(and(eq(schema.classroomQuizzes.id, quizId), eq(schema.classroomQuizzes.roomId, classroom.id), eq(schema.classroomQuizzes.isActive, true)))
      .limit(1);
    if (!quiz) throw notFound("Quiz not found");

    const [questions, attempts] = await Promise.all([
      orm
        .select({
          id: schema.classroomQuizQuestions.id,
          question: schema.classroomQuizQuestions.question,
          option_a: schema.classroomQuizQuestions.optionA,
          option_b: schema.classroomQuizQuestions.optionB,
          option_c: schema.classroomQuizQuestions.optionC,
          option_d: schema.classroomQuizQuestions.optionD,
        })
        .from(schema.classroomQuizQuestions)
        .where(eq(schema.classroomQuizQuestions.quizId, quizId))
        .orderBy(asc(schema.classroomQuizQuestions.position), asc(schema.classroomQuizQuestions.createdAt)),
      orm
        .select({
          score: schema.classroomQuizAttempts.score,
          passed: schema.classroomQuizAttempts.passed,
          xp_awarded: schema.classroomQuizAttempts.xpAwarded,
          completed_at: schema.classroomQuizAttempts.completedAt,
        })
        .from(schema.classroomQuizAttempts)
        .where(and(eq(schema.classroomQuizAttempts.quizId, quizId), eq(schema.classroomQuizAttempts.userId, auth.user.sub))),
    ]);

    return ok({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        xpReward: quiz.xp_reward,
        passScore: quiz.pass_score,
      },
      questions: questions.map((q) => ({
        id: q.id,
        question: q.question,
        options: [
          { key: "a", text: q.option_a },
          { key: "b", text: q.option_b },
          { key: "c", text: q.option_c },
          { key: "d", text: q.option_d },
        ],
      })),
      attempt: attempts[0]
        ? { score: attempts[0].score, passed: attempts[0].passed, xpAwarded: attempts[0].xp_awarded ?? 0, completedAt: new Date(attempts[0].completed_at ?? Date.now()).toISOString() }
        : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ roomId: string; quizId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageClassroom");
    const orm = await getDb();
    const updated = await orm
      .update(schema.classroomQuizzes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(schema.classroomQuizzes.id, assertUuid(params.quizId, "Quiz")), eq(schema.classroomQuizzes.roomId, classroom.id), eq(schema.classroomQuizzes.isActive, true)))
      .returning({ id: schema.classroomQuizzes.id });
    if (updated.length === 0) throw notFound("Quiz not found");
    return ok({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
});
