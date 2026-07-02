export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/[id]/route.ts
 *
 * GET    /api/answers/questions/:id — question detail
 * DELETE /api/answers/questions/:id — soft delete (author or moderator/admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getQuestionDetail } from "@/lib/forum/repo";
import { deleteQuestion, isUserModeratorOrAdmin } from "@/lib/forum/service";

export const GET = withAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const question = await getQuestionDetail(auth.user.sub, id);
    if (!question) throw notFound("Question not found");
    return NextResponse.json({ success: true, data: question, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumWrite);
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await deleteQuestion(id, auth.user.sub, isMod);
    return NextResponse.json({ success: true, data: { id }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
