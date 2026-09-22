export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/moderators/route.ts
 *
 * GET  /api/classroom/:roomId/moderators — active moderators (members + above)
 * POST /api/classroom/:roomId/moderators — { userId } grant moderator to an
 *      enrolled member, paid or free (creator/staff only)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { grantModerator, listModerators } from "@/lib/classroom/members";

const grantSchema = z.object({ userId: z.string().uuid() });

export const GET = withAuth<{ roomId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    return ok({ moderators: await listModerators(classroom.id) });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageClassroom");
    const body = await validateBody(req, grantSchema);
    await grantModerator(classroom, body.userId, auth.user.sub);
    return ok({ moderators: await listModerators(classroom.id) }, 201);
  } catch (err) {
    return handleApiError(err);
  }
});
