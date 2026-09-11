export const dynamic = 'force-dynamic';

/**
 * app/api/tweets/[tweetId]/like/route.ts
 *
 * POST   /api/tweets/:tweetId/like  — Like a Tweet (idempotent)
 * DELETE /api/tweets/:tweetId/like  — Unlike a Tweet (idempotent)
 *
 * Twitter-style single like/unlike toggle — unlike Moments' multi-emoji
 * reactions, a Tweet has exactly one "liked" state per viewer.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { likeTweet, unlikeTweet } from "@/lib/tweets/service";

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { tweetId } = await params as { tweetId: string };
    const result = await likeTweet(tweetId, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { tweetId } = await params as { tweetId: string };
    const result = await unlikeTweet(tweetId, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
