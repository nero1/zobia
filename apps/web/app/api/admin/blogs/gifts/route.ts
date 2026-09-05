export const dynamic = "force-dynamic";

/**
 * app/api/admin/blogs/gifts/route.ts
 *
 * GET /api/admin/blogs/gifts — every gift tier across every blog, for the
 * gate44 Rewarded Gifts admin screen.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { adminListAllGiftTiers } from "@/lib/blogs/repo";

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const tiers = await adminListAllGiftTiers();
    return NextResponse.json({ success: true, data: { tiers }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
