export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/eligibility/route.ts
 *
 * GET /api/business/ads/eligibility — used by the Advertising Panel
 * (/business/ads) and the /ads hub to decide whether to show the campaign
 * builder or a "why can't I advertise" explainer (verified Business
 * Account + KYC Tier 1+, see lib/ads/limits.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { checkAdvertiserEligibility } from "@/lib/ads/limits";

export const GET = withAuth(async (_req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const eligibility = await checkAdvertiserEligibility(auth.user.sub);
    return NextResponse.json({ success: true, data: eligibility, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
