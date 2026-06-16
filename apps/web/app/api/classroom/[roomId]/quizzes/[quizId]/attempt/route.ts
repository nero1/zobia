export const dynamic = 'force-dynamic';

/**
 * app/api/classroom/[roomId]/quizzes/[quizId]/attempt/route.ts
 *
 * POST /api/classroom/:roomId/quizzes/:quizId/attempt
 *   Submit a quiz attempt.
 *   Body: { answers: { [questionId]: 'a'|'b'|'c'|'d' } }
 *   - Must be enrolled in the classroom
 *   - Grades the answers
 *   - Inserts classroom_quiz_attempts
 *   - Awards XP to xp_knowledge track if passed
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const attemptSchema = z.object({
  answers: z.record(z.string().uuid(), z.enum(["a", "b", "c", "d"])),
});

// ---------------------------------------------------------------------------
// POST /api/classroom/:roomId/quizzes/:quizId/attempt
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: {
      params: { roomId: string; quizId: string };
      auth: { user: { sub: string } };
    }
  ) => {
    try {
      const { roomId, quizId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const body = await validateBody(req, attemptSchema);

      const result = await db.transaction(async (tx) => {
        // Verify enrolment in the classroom
        const { rows: enrolRows } = await tx.query<{ id: string }>(
          `SELECT id FROM classroom_enrolments
           WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
          [roomId, userId]
        );
        if (!enrolRows[0]) {
          throw forbidden("You must be enrolled in this classroom to take quizzes");
        }

        // Fetch quiz details
        const { rows: quizRows } = await tx.query<{
          id: string;
          xp_reward: number;
          pass_score: number;
          is_active: boolean;
        }>(
          `SELECT id, xp_reward, pass_score, is_active
           FROM classroom_quizzes
           WHERE id = $1 AND room_id = $2 LIMIT 1`,
          [quizId, roomId]
        );
        if (!quizRows[0]) throw notFound("Quiz not found");
        if (!quizRows[0].is_active) throw notFound("Quiz is no longer active");
        const quiz = quizRows[0];

        // Check not already attempted
        const { rows: existingAttempt } = await tx.query<{ id: string }>(
          `SELECT id FROM classroom_quiz_attempts
           WHERE quiz_id = $1 AND user_id = $2 LIMIT 1`,
          [quizId, userId]
        );
        if (existingAttempt.length > 0) {
          throw conflict("You have already submitted an attempt for this quiz");
        }

        // Fetch all questions for grading
        const { rows: questions } = await tx.query<{
          id: string;
          correct_option: string;
        }>(
          `SELECT id, correct_option FROM classroom_quiz_questions WHERE quiz_id = $1`,
          [quizId]
        );

        if (questions.length === 0) {
          throw notFound("Quiz has no questions");
        }

        // Grade the answers
        let correctCount = 0;
        for (const question of questions) {
          const submitted = body.answers[question.id];
          if (submitted && submitted === question.correct_option) {
            correctCount++;
          }
        }

        const score = Math.round((correctCount / questions.length) * 100);
        const passed = score >= quiz.pass_score;
        const xpAwarded = passed ? quiz.xp_reward : 0;

        // Insert attempt record — ON CONFLICT guards against concurrent duplicate
        // submissions racing past the SELECT check above (IMP-IDMP-02).
        const { rows: attemptRows } = await tx.query<{ id: string }>(
          `INSERT INTO classroom_quiz_attempts
             (quiz_id, user_id, score, passed, answers, xp_awarded, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (quiz_id, user_id) DO NOTHING
           RETURNING id`,
          [quizId, userId, score, passed, JSON.stringify(body.answers), xpAwarded]
        );
        if (!attemptRows[0]) {
          throw conflict("You have already submitted an attempt for this quiz");
        }
        const attemptId = attemptRows[0].id;

        // Award XP if passed
        if (passed && xpAwarded > 0) {
          await tx.query(
            `UPDATE users
             SET xp_total = xp_total + $1,
                 xp_knowledge = COALESCE(xp_knowledge, 0) + $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [xpAwarded, userId]
          );

          await tx.query(
            `INSERT INTO xp_ledger
               (user_id, amount, track, action, xp_amount, xp_net, source, reference_id, created_at)
             VALUES ($1, $2, 'knowledge', 'quiz_pass', $2, $2, 'classroom_quiz', $3, NOW())`,
            [userId, xpAwarded, attemptId]
          );
        }

        return {
          attemptId,
          quizId,
          score,
          passed,
          correctCount,
          totalQuestions: questions.length,
          xpAwarded,
        };
      });

      return NextResponse.json(
        { success: true, data: result, error: null },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
