export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/[id]/related/route.ts
 *
 * GET — related/new/recently-answered mini-lists shown below the answers
 * list on the question detail page (app/(app)/answers/[id]/page.tsx).
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { listRelatedQuestions, listNewQuestions, listRecentlyAnsweredQuestions } from "@/lib/forum/repo";

export const GET = withAuth(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const { rows } = await db.query<{ category_id: string | null }>(
      `SELECT category_id FROM forum_questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );
    if (!rows[0]) throw notFound("Question not found");

    const [related, newPosts, recentlyAnswered] = await Promise.all([
      listRelatedQuestions(rows[0].category_id, id, 5),
      listNewQuestions(3, id),
      listRecentlyAnsweredQuestions(3, id),
    ]);

    return NextResponse.json({ success: true, data: { related, newPosts, recentlyAnswered }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
