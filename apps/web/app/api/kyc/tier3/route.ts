export const dynamic = "force-dynamic";

/**
 * POST /api/kyc/tier3
 *
 * Requests Tier 3: manual, bank-grade physical KYC. Requires an approved
 * Tier 2. The applicant chooses whether to reuse their Tier 1/2 address or
 * supply an updated one — physical verification will be against whichever
 * address is on file, so this matters. An admin/mod schedules and completes
 * the physical check out-of-band, then approves/rejects from /admin/kyc.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { submitTier3 } from "@/lib/kyc/service";

const bodySchema = z.object({
  reusePreviousAddress: z.boolean(),
  updatedAddress: z.record(z.string(), z.string().max(200)).optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("kyc");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, bodySchema);
    const { submissionId } = await submitTier3(userId, body);

    return NextResponse.json({ success: true, data: { submissionId }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
