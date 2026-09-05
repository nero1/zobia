export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/gifts/[tierId]/reveal/route.ts
 *
 * GET — buyer only: reveal a purchased custom_reward tier's text instructions.
 * Returns { textInstructions: null } (not an error) if the caller never
 * purchased this tier, so the client can show a generic "not unlocked" state.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getGiftTextReveal } from "@/lib/blogs/service";

export const GET = withAuth<{ slug: string; tierId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const reveal = await getGiftTextReveal(auth.user.sub, params.tierId);
    return NextResponse.json({ success: true, data: reveal ?? { textInstructions: null }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
