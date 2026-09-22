export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/share/route.ts
 *
 * POST — record that the caller shared this classroom's /c/<slug> link
 * (feeds the creator panel's share stats). Best-effort from the client's
 * point of view — the Web Share / copy-link action never waits on it.
 */

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { forbidden, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { recordClassroomShare } from "@/lib/classroom/stats";

export const POST = withAuth<{ roomId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomVote);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    if (!classroom.isPublic && !viewer.can.viewMemberContent) throw forbidden("This classroom is private.", "CLASSROOM_PRIVATE");
    const result = await recordClassroomShare(classroom.id, auth.user.sub);
    return ok({ ...result, url: `/c/${classroom.slug ?? classroom.id}` });
  } catch (err) {
    return handleApiError(err);
  }
});
