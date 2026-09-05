export const dynamic = "force-dynamic";

/**
 * app/api/admin/blogs/themes/route.ts
 *
 * GET /api/admin/blogs/themes — full theme catalog (including disabled rows).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listAllThemes } from "@/lib/blogs/themes";

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const themes = await listAllThemes();
    return NextResponse.json({ success: true, data: { themes }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
