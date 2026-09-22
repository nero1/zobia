export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/posts/[postId]/like/route.ts
 *
 * POST   — like a post (the author earns 1 classroom point, Skool-style)
 * DELETE — unlike (the point is taken back)
 */

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { setLike } from "@/lib/classroom/community";

function handler(liked: boolean) {
  return withAuth<{ roomId: string; postId: string }>(async (_req: NextRequest, { params, auth }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomVote);
      const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
      requireCapability(viewer, "like");
      const postId = assertUuid(params.postId, "Post");
      return ok(await setLike(classroom, viewer, { kind: "post", id: postId }, liked));
    } catch (err) {
      return handleApiError(err);
    }
  });
}

export const POST = handler(true);
export const DELETE = handler(false);
