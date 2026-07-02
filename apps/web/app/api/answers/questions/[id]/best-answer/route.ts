export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/[id]/best-answer/route.ts
 *
 * POST /api/answers/questions/:id/best-answer — { answerId }
 * Only the question's author (or a moderator/admin) may mark a best answer.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { markBestAnswer, isUserModeratorOrAdmin } from "@/lib/forum/service";

const bodySchema = z.object({ answerId: z.string().uuid() });

export const POST = withAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumWrite);
    const body = await validateBody(req, bodySchema);
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await markBestAnswer(id, body.answerId, auth.user.sub, isMod);
    return NextResponse.json({ success: true, data: { questionId: id, answerId: body.answerId }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
