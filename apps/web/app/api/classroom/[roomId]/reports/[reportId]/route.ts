export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/reports/[reportId]/route.ts
 *
 * PATCH { action: 'remove' | 'dismiss', note? } — resolve a classroom report.
 * 'remove' hides the reported post/comment (reversible by a moderator).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { resolveReport } from "@/lib/classroom/community";

const patchSchema = z.object({
  action: z.enum(["remove", "dismiss"]),
  note: z.string().trim().max(500).optional().nullable(),
});

export const PATCH = withAuth<{ roomId: string; reportId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "handleReports");
    const body = await validateBody(req, patchSchema);
    await resolveReport({
      reportId: assertUuid(params.reportId, "Report"),
      roomId: classroom.id,
      action: body.action,
      resolverId: auth.user.sub,
      note: body.note,
    });
    return ok({ resolved: true });
  } catch (err) {
    return handleApiError(err);
  }
});
