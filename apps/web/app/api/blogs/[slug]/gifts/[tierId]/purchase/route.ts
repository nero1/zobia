export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/gifts/[tierId]/purchase/route.ts
 *
 * POST — buy a gift tier. { currency: "credits" | "stars" }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { sendGift } from "@/lib/blogs/service";

const purchaseSchema = z.object({
  currency: z.enum(["credits", "stars"]),
});

export const POST = withAuth<{ slug: string; tierId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, purchaseSchema);
    const result = await sendGift(auth.user.sub, params.tierId, body.currency);
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
