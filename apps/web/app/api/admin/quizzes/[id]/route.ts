export const dynamic = "force-dynamic";

/**
 * app/api/admin/quizzes/[id]/route.ts
 *
 * DELETE /api/admin/quizzes/<id> — moderator/admin: soft delete a quiz.
 */

import { NextRequest, NextResponse } from "next/server";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { deleteQuiz } from "@/lib/quizzes/service";

export const DELETE = withModeratorOrAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    await deleteQuiz(params.id);
    return NextResponse.json({ success: true, data: { id: params.id }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
