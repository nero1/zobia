export const dynamic = "force-dynamic";

/**
 * app/api/admin/wiki/[id]/transfer/route.ts
 *
 * POST /api/admin/wiki/<id>/transfer — admin-only: change the wiki's
 * owner to another user. { newOwnerId }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { transferWikiOwnership } from "@/lib/wiki/service";

const bodySchema = z.object({
  newOwnerId: z.string().uuid(),
});

export const POST = withAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, bodySchema);
    await transferWikiOwnership(params.id, auth.user.sub, body.newOwnerId);
    return NextResponse.json({ success: true, data: { transferred: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
