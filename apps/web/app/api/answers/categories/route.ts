export const dynamic = "force-dynamic";

/**
 * app/api/answers/categories/route.ts
 *
 * GET /api/answers/categories — list Answers categories, ordered for
 * display. Read-only reference data (no per-user state), used by the
 * "Ask a Question" category picker.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

export interface ForumCategoryOption {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
  questionCount: number;
}

export const GET = withAuth(async (_req: NextRequest) => {
  try {
    const { rows } = await db.query<{ id: string; slug: string; name: string; icon_emoji: string; question_count: string }>(
      `SELECT c.id, c.slug, c.name, c.icon_emoji,
              COUNT(q.id) FILTER (WHERE q.status = 'visible' AND q.deleted_at IS NULL) AS question_count
       FROM forum_categories c
       LEFT JOIN forum_questions q ON q.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`
    );
    const categories: ForumCategoryOption[] = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      iconEmoji: r.icon_emoji,
      questionCount: Number(r.question_count),
    }));
    return NextResponse.json({ success: true, data: categories, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
