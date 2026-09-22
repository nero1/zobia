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
import { db } from "@/lib/db";
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

    const { rows: quizRows } = await db.query<{ id: string; title: string; description: string | null; xp_reward: number; pass_score: number }>(
      `SELECT id, title, description, xp_reward, pass_score FROM classroom_quizzes
        WHERE id = $1 AND room_id = $2 AND is_active = TRUE`,
      [quizId, classroom.id]
    );
    const quiz = quizRows[0];
    if (!quiz) throw notFound("Quiz not found");

    const [{ rows: questions }, { rows: attempts }] = await Promise.all([
      db.query<{ id: string; question: string; option_a: string; option_b: string; option_c: string; option_d: string }>(
        `SELECT id, question, option_a, option_b, option_c, option_d
           FROM classroom_quiz_questions WHERE quiz_id = $1 ORDER BY position ASC, created_at ASC`,
        [quizId]
      ),
      db.query<{ score: number; passed: boolean; xp_awarded: number | null; completed_at: string }>(
        `SELECT score, passed, xp_awarded, completed_at FROM classroom_quiz_attempts WHERE quiz_id = $1 AND user_id = $2`,
        [quizId, auth.user.sub]
      ),
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
        ? { score: attempts[0].score, passed: attempts[0].passed, xpAwarded: attempts[0].xp_awarded ?? 0, completedAt: new Date(attempts[0].completed_at).toISOString() }
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
    const { rowCount } = await db.query(
      `UPDATE classroom_quizzes SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND room_id = $2 AND is_active = TRUE`,
      [assertUuid(params.quizId, "Quiz"), classroom.id]
    );
    if (rowCount === 0) throw notFound("Quiz not found");
    return ok({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
});
