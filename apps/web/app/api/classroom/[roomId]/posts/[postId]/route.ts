export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/posts/[postId]/route.ts
 *
 * GET    — one post (+ its comments)
 * PATCH  — author edits { title, body, category }; creator/moderators
 *          { isPinned, isLocked, isHidden }
 * DELETE — author, creator, moderators (managePosts), staff
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { deletePost, getPost, listComments, updatePost } from "@/lib/classroom/community";

const patchSchema = z
  .object({
    title: z.string().trim().max(200).nullable(),
    body: z.string().trim().min(1).max(10_000),
    category: z.string().trim().max(30),
    isPinned: z.boolean(),
    isLocked: z.boolean(),
    isHidden: z.boolean(),
  })
  .partial();

export const GET = withAuth<{ roomId: string; postId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    const postId = assertUuid(params.postId, "Post");
    const [post, comments] = await Promise.all([
      getPost(classroom, viewer, postId),
      listComments(classroom, viewer, postId),
    ]);
    return ok({ post, comments });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ roomId: string; postId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    const postId = assertUuid(params.postId, "Post");
    const body = await validateBody(req, patchSchema);
    return ok({ post: await updatePost(classroom, viewer, postId, body) });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ roomId: string; postId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    await deletePost(classroom, viewer, assertUuid(params.postId, "Post"));
    return ok({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
});
