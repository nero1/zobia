export const dynamic = 'force-dynamic';

/**
 * app/api/classroom/enrolled/route.ts
 *
 * GET /api/classroom/enrolled
 *
 * Lists the ClassRooms the authenticated user is enrolled in, with progress
 * summary fields consumed by the "Enrolled" tab on web and Android.
 *
 * completedLessons counts classroom_lesson_completions against the current
 * curriculum's module ids (lessons removed from the curriculum don't count);
 * quizScore is the best quiz score across the room's quizzes; points/level
 * are the member's standing in that classroom's own gamification.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface EnrolledRow {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  cover_emoji: string;
  creator_name: string;
  creator_username: string;
  creator_id: string;
  curriculum_title: string;
  enrolment_fee: string | number;
  member_count: number;
  category: string | null;
  start_date: string | null;
  end_date: string | null;
  lesson_count: number;
  completed_lessons: string;
  quiz_score: number | null;
  points: string | null;
  level: number | null;
  is_active: boolean | null;
  last_activity_at: string | null;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const userId = auth.user.sub;

    const orm = await getDb();
    const { rows } = await orm.execute<EnrolledRow & Record<string, unknown>>(sql`
      SELECT
         r.id,
         r.slug,
         r.name AS title,
         r.description,
         r.cover_emoji,
         COALESCE(u.display_name, u.username) AS creator_name,
         u.username AS creator_username,
         r.creator_id,
         COALESCE(r.curriculum->>'title', r.name) AS curriculum_title,
         COALESCE(r.enrolment_fee_ngn, 0) AS enrolment_fee,
         r.member_count,
         r.category,
         r.class_start_date::text AS start_date,
         r.class_end_date::text AS end_date,
         COALESCE(jsonb_array_length(r.curriculum->'modules'), 0) AS lesson_count,
         (SELECT COUNT(*) FROM classroom_lesson_completions lc
           WHERE lc.room_id = r.id AND lc.user_id = ce.user_id
             AND lc.module_id IN (SELECT m->>'id' FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(r.curriculum->'modules') = 'array'
                        THEN r.curriculum->'modules' ELSE '[]'::jsonb END) AS m)
         )::text AS completed_lessons,
         qa.best_score AS quiz_score,
         mp.points::text AS points,
         mp.level,
         r.is_active,
         GREATEST(ce.enrolled_at, ce.last_active_at, qa.last_attempt_at) AS last_activity_at
       FROM classroom_enrolments ce
       JOIN rooms r ON r.id = ce.room_id
       JOIN users u ON u.id = r.creator_id
       LEFT JOIN classroom_member_points mp ON mp.room_id = r.id AND mp.user_id = ce.user_id
       LEFT JOIN LATERAL (
         SELECT MAX(a.score) AS best_score, MAX(a.completed_at) AS last_attempt_at
         FROM classroom_quiz_attempts a
         JOIN classroom_quizzes q ON q.id = a.quiz_id
         WHERE q.room_id = r.id AND a.user_id = ce.user_id
       ) qa ON TRUE
       WHERE ce.user_id = ${userId} AND r.deleted_at IS NULL
       ORDER BY GREATEST(ce.enrolled_at, ce.last_active_at, qa.last_attempt_at) DESC NULLS LAST
    `);

    const rooms = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description ?? undefined,
      coverEmoji: row.cover_emoji,
      creatorName: row.creator_name,
      creatorUsername: row.creator_username,
      creatorId: row.creator_id,
      curriculumTitle: row.curriculum_title,
      enrolmentFee: Number(row.enrolment_fee),
      memberCount: row.member_count,
      category: row.category ?? "",
      startDate: row.start_date ?? "",
      endDate: row.end_date ?? "",
      isEnrolled: true,
      isActive: row.is_active !== false,
      lessonCount: Number(row.lesson_count),
      completedLessons: Number(row.completed_lessons),
      quizScore: row.quiz_score !== null ? Number(row.quiz_score) : null,
      points: Number(row.points ?? 0),
      level: row.level ?? 1,
      lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at).toISOString() : null,
    }));

    return NextResponse.json({ success: true, data: { rooms }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
