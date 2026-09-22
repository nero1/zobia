export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/posts/route.ts
 *
 * GET  /api/classroom/:roomId/posts?category=&sort=activity|new|top&cursor=
 *      Community feed (members, moderators, creator, staff).
 * POST /api/classroom/:roomId/posts — { title?, body, category? }
 *      New discussion post (respects the classroom's posting policy + mutes).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { createPost, listPosts } from "@/lib/classroom/community";

const listSchema = z.object({
  category: z.string().trim().max(30).optional(),
  sort: z.enum(["activity", "new", "top"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const createSchema = z.object({
  title: z.string().trim().max(200).optional().nullable(),
  body: z.string().trim().min(1).max(10_000),
  category: z.string().trim().max(30).optional().nullable(),
});

export const GET = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    const q = validateSearchParams(req.nextUrl.searchParams, listSchema);
    return ok(await listPosts(classroom, viewer, q));
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "createPost");
    const body = await validateBody(req, createSchema);
    return ok({ post: await createPost(classroom, viewer, body) }, 201);
  } catch (err) {
    return handleApiError(err);
  }
});
