export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/gifts/[tierId]/treasury/route.ts
 *
 * GET  — owner: this custom_reward tier's blog-level reward pot state.
 * POST — owner: fund (or top up) it. { amount: number (Credits) }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { fundBlogGiftTreasury, getGiftTierTreasury } from "@/lib/blogs/service";

const fundSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
});

export const GET = withAuth<{ slug: string; tierId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const treasury = await getGiftTierTreasury(params.tierId);
    return NextResponse.json({ success: true, data: { treasury }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string; tierId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const body = await validateBody(req, fundSchema);
    const treasury = await fundBlogGiftTreasury(auth.user.sub, params.tierId, body.amount);
    return NextResponse.json({ success: true, data: { treasury }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
