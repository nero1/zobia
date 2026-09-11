export const dynamic = 'force-dynamic';

/**
 * app/api/tweets/[tweetId]/retweet/route.ts
 *
 * POST   /api/tweets/:tweetId/retweet  — Retweet (or quote-retweet, with
 *                                         `{ quoteContent }`) a Tweet.
 * DELETE /api/tweets/:tweetId/retweet  — Un-retweet.
 *
 * Same feature/level gate as posting a Tweet — no separate charge.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { retweetTweet, unretweetTweet, TWEETS_HARD_CHAR_CAP } from "@/lib/tweets/service";

const retweetSchema = z.object({
  quoteContent: z.string().max(TWEETS_HARD_CHAR_CAP).optional(),
});

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { tweetId } = await params as { tweetId: string };
    const body = await validateBody(req, retweetSchema);
    const result = await retweetTweet(tweetId, auth.user.sub, body.quoteContent ?? null);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { tweetId } = await params as { tweetId: string };
    const result = await unretweetTweet(tweetId, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
