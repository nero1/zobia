export const dynamic = "force-dynamic";

/**
 * app/api/admin/blogs/gifts/[id]/route.ts
 *
 * PATCH /api/admin/blogs/gifts/<id> — admin override: enable/disable a gift
 * tier platform-wide, regardless of the owning blog.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { adminSetGiftTierEnabled } from "@/lib/blogs/service";

const bodySchema = z.object({ enabled: z.boolean() });

export const PATCH = withAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, bodySchema);
    await adminSetGiftTierEnabled(params.id, body.enabled);
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
