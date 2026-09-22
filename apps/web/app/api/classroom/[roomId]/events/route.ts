export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/events/route.ts
 *
 * GET  ?scope=upcoming|past|all — live-session schedule. Meeting/recording
 *      links are included only for members, moderators and the creator.
 * POST { title, description?, startsAt, endsAt?, meetingUrl?, recordingUrl? }
 *      — schedule a session (creator, moderators with manageEvents, staff).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { forbidden, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { createEvent, eventInputSchema, listEvents } from "@/lib/classroom/events";

const listSchema = z.object({ scope: z.enum(["upcoming", "past", "all"]).optional() });

export const GET = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    if ((!classroom.isPublic || !classroom.isActive) && !viewer.can.viewMemberContent) {
      throw forbidden("This classroom is private.", "CLASSROOM_PRIVATE");
    }
    const q = validateSearchParams(req.nextUrl.searchParams, listSchema);
    return ok({ events: await listEvents(classroom, viewer, q.scope ?? "all") });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageEvents");
    const body = await validateBody(req, eventInputSchema);
    return ok({ event: await createEvent(classroom, viewer, body) }, 201);
  } catch (err) {
    return handleApiError(err);
  }
});
