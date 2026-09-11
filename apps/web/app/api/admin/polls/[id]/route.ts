export const dynamic = "force-dynamic";

/**
 * app/api/admin/polls/[id]/route.ts
 *
 * DELETE /api/admin/polls/<id> — moderator/admin: soft delete a poll.
 */

import { NextRequest, NextResponse } from "next/server";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { deletePoll } from "@/lib/polls/service";

export const DELETE = withModeratorOrAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    await deletePoll(params.id);
    return NextResponse.json({ success: true, data: { id: params.id }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
