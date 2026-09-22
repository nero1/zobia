export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/members/route.ts
 *
 * GET /api/classroom/:roomId/members?search=&filter=all|moderators|paid|muted&offset=
 *   Member roster with points/level/progress. Creator, moderators with the
 *   manageMembers permission, and staff only (the roster reveals who paid).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { listMembers } from "@/lib/classroom/members";

const querySchema = z.object({
  search: z.string().trim().max(60).optional(),
  filter: z.enum(["all", "moderators", "paid", "muted"]).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    if (!viewer.can.manageClassroom) requireCapability(viewer, "manageMembers");
    const q = validateSearchParams(req.nextUrl.searchParams, querySchema);
    return ok(await listMembers(classroom.id, q));
  } catch (err) {
    return handleApiError(err);
  }
});
