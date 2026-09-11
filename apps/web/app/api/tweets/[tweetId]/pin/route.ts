export const dynamic = 'force-dynamic';

/**
 * app/api/tweets/[tweetId]/pin/route.ts
 *
 * POST   /api/tweets/:tweetId/pin  — Pin this Tweet to the caller's profile
 *                                    (atomically unpins any previous pin)
 * DELETE /api/tweets/:tweetId/pin  — Unpin
 *
 * Owner-only — see lib/tweets/service.ts's pinTweet/unpinTweet.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { pinTweet, unpinTweet } from "@/lib/tweets/service";

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { tweetId } = await params as { tweetId: string };
    await pinTweet(tweetId, auth.user.sub);
    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { tweetId } = await params as { tweetId: string };
    await unpinTweet(tweetId, auth.user.sub);
    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
