export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/events/[eventId]/route.ts
 *
 * PATCH  — edit a session, or attach/replace/remove its recording link
 *          (members are notified when a recording is first added)
 * DELETE — cancel a session
 * Creator, moderators with manageEvents, staff.
 */

import { NextRequest } from "next/server";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { deleteEvent, eventPatchSchema, updateEvent } from "@/lib/classroom/events";

export const PATCH = withAuth<{ roomId: string; eventId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageEvents");
    const body = await validateBody(req, eventPatchSchema);
    return ok({ event: await updateEvent(classroom, viewer, assertUuid(params.eventId, "Session"), body) });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ roomId: string; eventId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageEvents");
    await deleteEvent(classroom, assertUuid(params.eventId, "Session"));
    return ok({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
});
