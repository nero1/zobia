export const dynamic = "force-dynamic";

/**
 * app/api/admin/blogs/[id]/transfer/route.ts
 *
 * POST /api/admin/blogs/<id>/transfer — admin-only: change the blog's
 * creator/owner to another user. { newOwnerId }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { transferBlogOwnership } from "@/lib/blogs/service";

const bodySchema = z.object({
  newOwnerId: z.string().uuid(),
});

export const POST = withAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, bodySchema);
    await transferBlogOwnership(params.id, auth.user.sub, body.newOwnerId);
    return NextResponse.json({ success: true, data: { transferred: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
