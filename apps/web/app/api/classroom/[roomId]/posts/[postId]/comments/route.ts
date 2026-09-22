export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/posts/[postId]/comments/route.ts
 *
 * GET  — comments on a post (one level of threading via parentId)
 * POST — { body, parentId? } add a comment / reply
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { createComment, listComments } from "@/lib/classroom/community";

const createSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  parentId: z.string().uuid().optional().nullable(),
});

export const GET = withAuth<{ roomId: string; postId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    return ok({ comments: await listComments(classroom, viewer, assertUuid(params.postId, "Post")) });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ roomId: string; postId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "comment");
    const body = await validateBody(req, createSchema);
    const comment = await createComment(classroom, viewer, assertUuid(params.postId, "Post"), body);
    return ok({ comment }, 201);
  } catch (err) {
    return handleApiError(err);
  }
});
