export const dynamic = "force-dynamic";

/**
 * app/api/classroom/:roomId/members/:userId
 *
 * PATCH { muteHours: number | null } — mute a member from posting/commenting
 * in this classroom's community for N hours (null = unmute). Creator,
 * moderators with manageMembers, and staff. Moderators can't mute other
 * moderators (lib/classroom/members.ts enforces this).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { assertUuid, classroomContextFromParams, ok } from "@/lib/classroom/http";
import { setMemberMute } from "@/lib/classroom/members";

const patchSchema = z.object({
  muteHours: z.number().int().min(1).max(24 * 365).nullable(),
});

export const PATCH = withAuth<{ roomId: string; userId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageMembers");
    const targetId = assertUuid(params.userId, "Member");
    const body = await validateBody(req, patchSchema);
    const result = await setMemberMute(
      classroom,
      targetId,
      { userId: auth.user.sub, isCreatorOrStaff: viewer.isCreator || viewer.isStaff },
      body.muteHours
    );
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
});
