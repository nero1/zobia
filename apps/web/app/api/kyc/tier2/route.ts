export const dynamic = "force-dynamic";

/**
 * POST /api/kyc/tier2
 *
 * Submit Tier 2: a public YouTube statement video + government ID + a
 * selfie for a lightweight AI liveness heuristic (see lib/kyc/service.ts
 * docblock for what this is/isn't). Requires an approved Tier 1. Always
 * queued for manual review.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { submitTier2 } from "@/lib/kyc/service";

const bodySchema = z.object({
  videoUrl: z.string().url().max(500),
  documentIds: z.array(z.string().uuid()).min(2).max(4),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("kyc");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, bodySchema);
    const { submissionId } = await submitTier2(userId, body);

    return NextResponse.json({ success: true, data: { submissionId }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
