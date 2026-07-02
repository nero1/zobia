export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/[id]/answers/[answerId]/route.ts
 *
 * DELETE /api/answers/questions/:id/answers/:answerId — soft delete (author or moderator/admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { deleteAnswer, isUserModeratorOrAdmin } from "@/lib/forum/service";

export const DELETE = withAuth<{ id: string; answerId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { answerId } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumWrite);
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await deleteAnswer(answerId, auth.user.sub, isMod);
    return NextResponse.json({ success: true, data: { id: answerId }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
