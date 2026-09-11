export const dynamic = "force-dynamic";

/**
 * app/api/admin/polls/[id]/status/route.ts
 *
 * PATCH /api/admin/polls/<id>/status — moderator/admin action on a poll:
 *   { status: "active" | "closed" | "disabled" }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withModeratorOrAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { setPollStatus } from "@/lib/polls/service";

const patchSchema = z.object({
  status: z.enum(["active", "closed", "disabled"]),
});

export const PATCH = withModeratorOrAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, patchSchema);
    await setPollStatus(params.id, body.status);
    return NextResponse.json({ success: true, data: { status: body.status }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
