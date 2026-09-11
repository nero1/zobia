export const dynamic = 'force-dynamic';

/**
 * app/api/tweets/policy/route.ts
 *
 * GET /api/tweets/policy — The caller's effective Tweet-length policy:
 * default/personal/long-form-ceiling lengths, whether they're long-form
 * exempt (free long Tweets), the long-Tweet Credits cost, and their current
 * Credits balance. The composer uses this to size its character counter and
 * decide when to show the "this will cost N Credits" prompt — mirrors the
 * Moments composer's cost-notice pattern.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getTweetsEligibility } from "@/lib/tweets/service";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const eligibility = await getTweetsEligibility(auth.user.sub);
    return NextResponse.json({
      success: true,
      data: {
        defaultMaxLength: eligibility.defaultMaxLength,
        personalMaxLength: eligibility.personalMaxLength,
        longMaxLengthChars: eligibility.longMaxLengthChars,
        isLongFormExempt: eligibility.isLongFormExempt,
        longTweetCostCredits: eligibility.longTweetCostCredits,
        creditBalance: eligibility.creditBalance,
        minLevel: eligibility.minLevel,
        currentLevel: eligibility.rankNumber,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
