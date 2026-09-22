export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/comments/[commentId]/like/route.ts
 *
 * POST   — like a comment (the author earns 1 classroom point)
 * DELETE — unlike
 */

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { setLike } from "@/lib/classroom/community";

function handler(liked: boolean) {
  return withAuth<{ roomId: string; commentId: string }>(async (_req: NextRequest, { params, auth }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomVote);
      const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
      requireCapability(viewer, "like");
      const commentId = assertUuid(params.commentId, "Comment");
      return ok(await setLike(classroom, viewer, { kind: "comment", id: commentId }, liked));
    } catch (err) {
      return handleApiError(err);
    }
  });
}

export const POST = handler(true);
export const DELETE = handler(false);
