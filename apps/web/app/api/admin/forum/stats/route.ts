export const dynamic = "force-dynamic";

/**
 * app/api/admin/forum/stats/route.ts
 *
 * GET /api/admin/forum/stats — dashboard counts for /admin/forum.
 */

import { NextRequest, NextResponse } from "next/server";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

export const GET = withModeratorOrAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const [pendingReports, questionsToday, answersToday, topPosters] = await Promise.all([
      db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM moderation_reports
         WHERE status = 'pending' AND (reported_forum_question_id IS NOT NULL OR reported_forum_answer_id IS NOT NULL)`
      ),
      db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM forum_questions WHERE created_at >= CURRENT_DATE`
      ),
      db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM forum_answers WHERE created_at >= CURRENT_DATE`
      ),
      db.query<{ username: string | null; questions: string; answers: string }>(
        `SELECT u.username,
                COUNT(DISTINCT q.id)::text AS questions,
                COUNT(DISTINCT a.id)::text AS answers
         FROM users u
         LEFT JOIN forum_questions q ON q.author_id = u.id AND q.created_at >= NOW() - INTERVAL '7 days'
         LEFT JOIN forum_answers a ON a.author_id = u.id AND a.created_at >= NOW() - INTERVAL '7 days'
         WHERE u.id IN (
           SELECT author_id FROM forum_questions WHERE created_at >= NOW() - INTERVAL '7 days'
           UNION
           SELECT author_id FROM forum_answers WHERE created_at >= NOW() - INTERVAL '7 days'
         )
         GROUP BY u.id, u.username
         ORDER BY (COUNT(DISTINCT q.id) + COUNT(DISTINCT a.id)) DESC
         LIMIT 10`
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        pendingReports: parseInt(pendingReports.rows[0]?.cnt ?? "0", 10),
        questionsToday: parseInt(questionsToday.rows[0]?.cnt ?? "0", 10),
        answersToday: parseInt(answersToday.rows[0]?.cnt ?? "0", 10),
        topPosters: topPosters.rows,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
