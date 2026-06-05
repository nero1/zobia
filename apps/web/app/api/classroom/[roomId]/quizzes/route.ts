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
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getTrackLevelForXP } from "@/lib/xp/engine";

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
  xp_reward: z.number().int().positive().default(50),
  pass_score: z.number().int().min(1).max(100).default(70),
  questions: z.array(questionSchema).min(1).max(50),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuizRow {
  id: string;
  room_id: string;
  creator_id: string;
  title: string;
  description: string | null;
  xp_reward: number;
  pass_score: number;
  is_active: boolean;
  created_at: string;
  question_count: string;
}

// ---------------------------------------------------------------------------
// GET /api/classroom/:roomId/quizzes
// ---------------------------------------------------------------------------

export const GET = withAuth(
  async (
    _req: NextRequest,
    { params }: { params: { roomId: string }; auth: unknown }
  ) => {
    try {
      const { roomId } = await params;

      const { rows } = await db.query<QuizRow>(
        `SELECT
           cq.id, cq.room_id, cq.creator_id, cq.title, cq.description,
           cq.xp_reward, cq.pass_score, cq.is_active, cq.created_at,
           COUNT(cqq.id)::TEXT AS question_count
         FROM classroom_quizzes cq
         LEFT JOIN classroom_quiz_questions cqq ON cqq.quiz_id = cq.id
         WHERE cq.room_id = $1 AND cq.is_active = TRUE
         GROUP BY cq.id
         ORDER BY cq.created_at DESC`,
        [roomId]
      );

      const quizzes = rows.map((q) => ({
        ...q,
        questionCount: parseInt(q.question_count, 10),
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

      // Verify caller is the room creator
      const { rows: roomRows } = await db.query<{ creator_id: string; room_type: string }>(
        `SELECT creator_id, room_type FROM rooms WHERE id = $1 AND is_active = TRUE LIMIT 1`,
        [roomId]
      );
      if (!roomRows[0]) throw notFound("Room not found");
      if (roomRows[0].creator_id !== userId) {
        throw forbidden("Only the room creator can create quizzes");
      }
      if (roomRows[0].room_type !== "classroom") {
        throw forbidden("Quizzes can only be created in classroom rooms");
      }

      // Enforce Knowledge Track Level 40 gate (PRD §7)
      const { rows: xpRows } = await db.query<{ xp_knowledge: number }>(
        `SELECT xp_knowledge FROM users WHERE id = $1`,
        [userId]
      );
      const creatorKnowledgeXP = xpRows[0]?.xp_knowledge ?? 0;
      const knowledgeTrackInfo = getTrackLevelForXP("knowledge", creatorKnowledgeXP);
      if (knowledgeTrackInfo.level < MIN_KNOWLEDGE_LEVEL_FOR_QUIZZES) {
        throw forbidden(
          `You must reach Knowledge Track Level ${MIN_KNOWLEDGE_LEVEL_FOR_QUIZZES} to create quizzes. Your current Knowledge Track level is ${knowledgeTrackInfo.level}.`
        );
      }

      const body = await validateBody(req, createQuizSchema);

      const result = await db.transaction(async (tx) => {
        // Insert quiz
        const { rows: quizRows } = await tx.query<{ id: string }>(
          `INSERT INTO classroom_quizzes
             (room_id, creator_id, title, description, xp_reward, pass_score, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
           RETURNING id`,
          [
            roomId,
            userId,
            body.title,
            body.description ?? null,
            body.xp_reward,
            body.pass_score,
          ]
        );
        const quizId = quizRows[0].id;

        // Insert questions
        for (let i = 0; i < body.questions.length; i++) {
          const q = body.questions[i];
          await tx.query(
            `INSERT INTO classroom_quiz_questions
               (quiz_id, question, option_a, option_b, option_c, option_d,
                correct_option, position, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [
              quizId,
              q.question,
              q.option_a,
              q.option_b,
              q.option_c,
              q.option_d,
              q.correct_option,
              i,
            ]
          );
        }

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
