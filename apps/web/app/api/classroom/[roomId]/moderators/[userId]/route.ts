export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/moderators/[userId]/route.ts
 *
 * DELETE /api/classroom/:roomId/moderators/:userId — revoke moderator
 * (creator/staff only; a moderator may also step down themselves).
 */

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { listModerators, revokeModerator } from "@/lib/classroom/members";

export const DELETE = withAuth<{ roomId: string; userId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    const targetId = assertUuid(params.userId, "Moderator");
    const selfStepDown = targetId === auth.user.sub && viewer.isModerator;
    if (!selfStepDown) requireCapability(viewer, "manageClassroom");
    await revokeModerator(classroom, targetId, auth.user.sub);
    return ok({ moderators: await listModerators(classroom.id) });
  } catch (err) {
    return handleApiError(err);
  }
});
