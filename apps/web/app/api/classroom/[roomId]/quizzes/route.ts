export const dynamic = 'force-dynamic';

/**
 * app/api/classroom/[roomId]/quizzes/route.ts
 *
 * GET /api/classroom/:roomId/quizzes
 *   List all quizzes for a classroom room.
 *
 * POST /api/classroom/:roomId/quizzes
 *   Create a quiz (room creator only).
 *   Body: { title, description, xp_reward, pass_score, questions: [...] }
 *   Inserts quiz + questions in a transaction.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getTrackLevelForXP } from "@/lib/xp/engine";
import { classroomContextFromParams } from "@/lib/classroom/http";

// ---------------------------------------------------------------------------
// Feature gate constants
// ---------------------------------------------------------------------------

const MIN_KNOWLEDGE_LEVEL_FOR_QUIZZES = 40;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const questionSchema = z.object({
  question: z.string().min(5).max(500),
  option_a: z.string().min(1).max(200),
  option_b: z.string().min(1).max(200),
  option_c: z.string().min(1).max(200),
  option_d: z.string().min(1).max(200),
  correct_option: z.enum(["a", "b", "c", "d"]),
});

const createQuizSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  // Capped: this is Knowledge-track XP minted per passing student, so an
  // unbounded creator-set value was an XP-farming vector (sock-puppet members).
  xp_reward: z.number().int().positive().max(500).default(50),
  pass_score: z.number().int().min(1).max(100).default(70),
  questions: z.array(questionSchema).min(1).max(50),
});

// ---------------------------------------------------------------------------
// GET /api/classroom/:roomId/quizzes
// ---------------------------------------------------------------------------

export const GET = withAuth<{ roomId: string }>(
  async (_req: NextRequest, { params, auth }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
      const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
      if ((!classroom.isPublic || !classroom.isActive) && !viewer.can.viewMemberContent) {
        throw forbidden("This classroom is private.", "CLASSROOM_PRIVATE");
      }
      const roomId = classroom.id;

      const orm = await getDb();
      const rows = await orm
        .select({
          id: schema.classroomQuizzes.id,
          room_id: schema.classroomQuizzes.roomId,
          creator_id: schema.classroomQuizzes.creatorId,
          title: schema.classroomQuizzes.title,
          description: schema.classroomQuizzes.description,
          xp_reward: schema.classroomQuizzes.xpReward,
          pass_score: schema.classroomQuizzes.passScore,
          is_active: schema.classroomQuizzes.isActive,
          created_at: schema.classroomQuizzes.createdAt,
          question_count: sql<string>`(SELECT COUNT(*) FROM classroom_quiz_questions cqq WHERE cqq.quiz_id = ${schema.classroomQuizzes.id})::TEXT`,
          my_score: schema.classroomQuizAttempts.score,
          my_passed: schema.classroomQuizAttempts.passed,
        })
        .from(schema.classroomQuizzes)
        .leftJoin(
          schema.classroomQuizAttempts,
          and(
            eq(schema.classroomQuizAttempts.quizId, schema.classroomQuizzes.id),
            eq(schema.classroomQuizAttempts.userId, auth.user.sub)
          )
        )
        .where(and(eq(schema.classroomQuizzes.roomId, roomId), eq(schema.classroomQuizzes.isActive, true)))
        .orderBy(desc(schema.classroomQuizzes.createdAt));

      const quizzes = rows.map((q) => ({
        ...q,
        questionCount: parseInt(q.question_count, 10),
        attempted: q.my_score !== null,
        myScore: q.my_score,
        passed: q.my_passed === true,
      }));

      return NextResponse.json({
        success: true,
        data: { quizzes },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/classroom/:roomId/quizzes
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: { roomId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { roomId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const orm = await getDb();

      // Verify caller is the room creator
      const [room] = await orm
        .select({ creatorId: schema.rooms.creatorId, type: schema.rooms.type })
        .from(schema.rooms)
        .where(and(eq(schema.rooms.id, roomId), eq(schema.rooms.isActive, true)))
        .limit(1);
      if (!room) throw notFound("Room not found");
      if (room.creatorId !== userId) {
        throw forbidden("Only the room creator can create quizzes");
      }
      if (room.type !== "classroom") {
        throw forbidden("Quizzes can only be created in classroom rooms");
      }

      // Enforce Knowledge Track Level 40 gate (PRD §7)
      const [xpRow] = await orm
        .select({ xpKnowledge: schema.users.xpKnowledge })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      const creatorKnowledgeXP = Number(xpRow?.xpKnowledge ?? 0);
      const knowledgeTrackInfo = getTrackLevelForXP("knowledge", creatorKnowledgeXP);
      if (knowledgeTrackInfo.level < MIN_KNOWLEDGE_LEVEL_FOR_QUIZZES) {
        throw forbidden(
          `You must reach Knowledge Track Level ${MIN_KNOWLEDGE_LEVEL_FOR_QUIZZES} to create quizzes. Your current Knowledge Track level is ${knowledgeTrackInfo.level}.`
        );
      }

      const body = await validateBody(req, createQuizSchema);

      const result = await orm.transaction(async (tx) => {
        // Insert quiz
        const [quiz] = await tx
          .insert(schema.classroomQuizzes)
          .values({
            roomId,
            creatorId: userId,
            title: body.title,
            description: body.description ?? null,
            xpReward: body.xp_reward,
            passScore: body.pass_score,
            isActive: true,
          })
          .returning({ id: schema.classroomQuizzes.id });
        const quizId = quiz.id;

        // Insert questions
        await tx.insert(schema.classroomQuizQuestions).values(
          body.questions.map((q, i) => ({
            quizId,
            question: q.question,
            optionA: q.option_a,
            optionB: q.option_b,
            optionC: q.option_c,
            optionD: q.option_d,
            correctOption: q.correct_option,
            position: i,
          }))
        );

        return { quizId, questionCount: body.questions.length };
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
