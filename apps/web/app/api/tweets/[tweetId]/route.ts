export const dynamic = 'force-dynamic';

/**
 * app/api/tweets/[tweetId]/route.ts
 *
 * GET    /api/tweets/:tweetId  — Fetch a single Tweet (stable deep-link target)
 * DELETE /api/tweets/:tweetId  — Delete own Tweet
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { deleteTweet } from "@/lib/tweets/service";

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { tweetId } = await params as { tweetId: string };
    const userId = auth.user.sub;

    const { rows } = await db.query(
      `SELECT t.id, t.user_id, t.parent_tweet_id, u.username, u.avatar_emoji, u.avatar_url,
              u.is_verified, u.prestige_count, u.xp_total,
              t.content, t.image_url, t.video_provider, t.video_url, t.video_embed_id,
              t.is_pinned, t.likes_count, t.replies_count, t.retweets_count, t.created_at,
              (EXISTS (SELECT 1 FROM tweet_likes tl WHERE tl.tweet_id = t.id AND tl.user_id = $2)) AS liked,
              (EXISTS (SELECT 1 FROM tweet_retweets tr WHERE tr.tweet_id = t.id AND tr.user_id = $2)) AS retweeted
       FROM tweets t JOIN users u ON u.id = t.user_id
       WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [tweetId, userId]
    );
    if (!rows[0]) throw notFound("Tweet not found");

    return NextResponse.json({ success: true, data: rows[0], error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { tweetId } = await params as { tweetId: string };
    await deleteTweet(tweetId, auth.user.sub);
    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
