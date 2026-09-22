export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/comments/[commentId]/route.ts
 *
 * PATCH  { isHidden } — hide/restore a comment (creator/moderators/staff)
 * DELETE             — delete a comment and its replies (author or moderators)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { deleteComment, setCommentHidden } from "@/lib/classroom/community";

const patchSchema = z.object({ isHidden: z.boolean() });

export const PATCH = withAuth<{ roomId: string; commentId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "managePosts");
    const body = await validateBody(req, patchSchema);
    await setCommentHidden(classroom, viewer, assertUuid(params.commentId, "Comment"), body.isHidden);
    return ok({ isHidden: body.isHidden });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ roomId: string; commentId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    await deleteComment(classroom, viewer, assertUuid(params.commentId, "Comment"));
    return ok({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
});
