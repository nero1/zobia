export const dynamic = 'force-dynamic';

/**
 * app/api/classroom/enrolled/route.ts
 *
 * GET /api/classroom/enrolled
 *
 * Lists the ClassRooms the authenticated user is enrolled in, with progress
 * summary fields consumed by the "My ClassRooms" tab (apps/web and the
 * Capacitor app's classroom.tsx both call this — it previously 404'd since
 * this route never existed, so "My ClassRooms" was silently always empty).
 *
 * completedLessons is always 0 — there is no per-lesson completion tracking
 * table in the schema yet (only classroom_quiz_attempts, which is per-quiz,
 * not per-lesson). quizScore reflects the best passing/attempted quiz score
 * across the room's quizzes.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

interface EnrolledRow {
  id: string;
  title: string;
  description: string | null;
  creator_name: string;
  creator_id: string;
  curriculum_title: string;
  enrolment_fee: number;
  member_count: number;
  category: string | null;
  start_date: string | null;
  end_date: string | null;
  lesson_count: number;
  quiz_score: number | null;
  last_activity_at: string | null;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<EnrolledRow>(
      `SELECT
         r.id,
         r.name AS title,
         r.description,
         COALESCE(u.display_name, u.username) AS creator_name,
         r.creator_id,
         COALESCE(r.curriculum->>'title', r.name) AS curriculum_title,
         COALESCE(r.enrolment_fee_ngn, 0) AS enrolment_fee,
         r.member_count,
         r.category,
         r.class_start_date::text AS start_date,
         r.class_end_date::text AS end_date,
         COALESCE(jsonb_array_length(r.curriculum->'modules'), 0) AS lesson_count,
         qa.best_score AS quiz_score,
         GREATEST(ce.enrolled_at, qa.last_attempt_at) AS last_activity_at
       FROM classroom_enrolments ce
       JOIN rooms r ON r.id = ce.room_id
       JOIN users u ON u.id = r.creator_id
       LEFT JOIN LATERAL (
         SELECT MAX(a.score) AS best_score, MAX(a.completed_at) AS last_attempt_at
         FROM classroom_quiz_attempts a
         JOIN classroom_quizzes q ON q.id = a.quiz_id
         WHERE q.room_id = r.id AND a.user_id = ce.user_id
       ) qa ON TRUE
       WHERE ce.user_id = $1 AND r.deleted_at IS NULL
       ORDER BY COALESCE(qa.last_attempt_at, ce.enrolled_at) DESC`,
      [userId]
    );

    const rooms = rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      creatorName: row.creator_name,
      creatorId: row.creator_id,
      curriculumTitle: row.curriculum_title,
      enrolmentFee: Number(row.enrolment_fee),
      memberCount: row.member_count,
      category: row.category ?? "",
      startDate: row.start_date ?? "",
      endDate: row.end_date ?? "",
      isEnrolled: true,
      lessonCount: Number(row.lesson_count),
      completedLessons: 0,
      quizScore: row.quiz_score !== null ? Number(row.quiz_score) : null,
      lastActivityAt: row.last_activity_at,
    }));

    return NextResponse.json({ success: true, data: { rooms }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
