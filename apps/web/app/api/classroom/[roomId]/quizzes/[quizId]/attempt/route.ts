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
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { awardClassroomPoints } from "@/lib/classroom/gamification";

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

      const orm = await getDb();
      const result = await orm.transaction(async (tx) => {
        // Verify enrolment in the classroom
        const [enrolment] = await tx
          .select({ id: schema.classroomEnrolments.id })
          .from(schema.classroomEnrolments)
          .where(and(eq(schema.classroomEnrolments.roomId, roomId), eq(schema.classroomEnrolments.userId, userId)))
          .limit(1);
        if (!enrolment) {
          throw forbidden("You must be enrolled in this classroom to take quizzes");
        }

        // Fetch quiz details
        const [quiz] = await tx
          .select({
            id: schema.classroomQuizzes.id,
            xpReward: schema.classroomQuizzes.xpReward,
            passScore: schema.classroomQuizzes.passScore,
            isActive: schema.classroomQuizzes.isActive,
          })
          .from(schema.classroomQuizzes)
          .where(and(eq(schema.classroomQuizzes.id, quizId), eq(schema.classroomQuizzes.roomId, roomId)))
          .limit(1);
        if (!quiz) throw notFound("Quiz not found");
        if (!quiz.isActive) throw notFound("Quiz is no longer active");

        // Check not already attempted
        const [existingAttempt] = await tx
          .select({ id: schema.classroomQuizAttempts.id })
          .from(schema.classroomQuizAttempts)
          .where(and(eq(schema.classroomQuizAttempts.quizId, quizId), eq(schema.classroomQuizAttempts.userId, userId)))
          .limit(1);
        if (existingAttempt) {
          throw conflict("You have already submitted an attempt for this quiz");
        }

        // Fetch all questions for grading
        const questions = await tx
          .select({ id: schema.classroomQuizQuestions.id, correctOption: schema.classroomQuizQuestions.correctOption })
          .from(schema.classroomQuizQuestions)
          .where(eq(schema.classroomQuizQuestions.quizId, quizId));

        if (questions.length === 0) {
          throw notFound("Quiz has no questions");
        }

        // Grade the answers
        let correctCount = 0;
        for (const question of questions) {
          const submitted = body.answers[question.id];
          if (submitted && submitted === question.correctOption) {
            correctCount++;
          }
        }

        const score = Math.round((correctCount / questions.length) * 100);
        const passed = score >= quiz.passScore;
        const xpAwarded = passed ? quiz.xpReward : 0;

        // Insert attempt record — ON CONFLICT guards against concurrent duplicate
        // submissions racing past the SELECT check above (IMP-IDMP-02).
        const [attempt] = await tx
          .insert(schema.classroomQuizAttempts)
          .values({
            quizId,
            userId,
            score,
            passed,
            answers: body.answers,
            xpAwarded,
          })
          .onConflictDoNothing({
            target: [schema.classroomQuizAttempts.quizId, schema.classroomQuizAttempts.userId],
          })
          .returning({ id: schema.classroomQuizAttempts.id });
        if (!attempt) {
          throw conflict("You have already submitted an attempt for this quiz");
        }
        const attemptId = attempt.id;

        // Award XP if passed. safeAwardXP is the canonical XP-award path — it
        // writes the xp_ledger row (with the required NOT NULL base_amount),
        // updates the user's track XP + total XP, and upserts leaderboard
        // snapshots, all within this transaction.
        if (passed && xpAwarded > 0) {
          await safeAwardXP(userId, xpAwarded, "knowledge", "classroom_quiz", attemptId, tx);
        }

        // Per-classroom gamification: passing a quiz earns classroom points
        // (and a perfect score earns the Quiz Ace badge). Idempotent per quiz.
        let classroomPointsAwarded = 0;
        if (passed) {
          const [room] = await tx
            .select({ slug: schema.rooms.slug, name: schema.rooms.name })
            .from(schema.rooms)
            .where(eq(schema.rooms.id, roomId));
          const award = await awardClassroomPoints(
            {
              roomId,
              userId,
              source: "quiz_passed",
              referenceId: quizId,
              badgeSignals: { perfectQuiz: score === 100 },
              classroom: { slug: room?.slug ?? null, name: room?.name ?? "" },
            },
            tx
          );
          classroomPointsAwarded = award.awarded;
          await tx
            .update(schema.classroomEnrolments)
            .set({ lastActiveAt: new Date() })
            .where(and(eq(schema.classroomEnrolments.roomId, roomId), eq(schema.classroomEnrolments.userId, userId)));
        }

        return {
          attemptId,
          quizId,
          score,
          passed,
          correctCount,
          totalQuestions: questions.length,
          xpAwarded,
          classroomPointsAwarded,
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
