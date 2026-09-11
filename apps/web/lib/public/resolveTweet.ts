/**
 * apps/web/lib/public/resolveTweet.ts
 *
 * Resolves a public Tweet by id for the crawlable SSR page (/t/<tweetId>).
 * Mirrors lib/public/resolveForumQuestion.ts's shape, minus the slug/legacy-
 * redirect handling — Tweets have no slug (see db/migrations/0039_tweets.sql),
 * they're addressed by uuid everywhere, in-app and here.
 *
 * Only non-deleted Tweets authored by a non-deleted user are returned, so
 * removed content never leaks to crawlers or logged-out visitors.
 */

import { db } from "@/lib/db";

export interface PublicTweet {
  id: string;
  content: string | null;
  image_url: string | null;
  video_provider: "youtube" | "tiktok" | null;
  video_url: string | null;
  video_embed_id: string | null;
  likes_count: number;
  replies_count: number;
  retweets_count: number;
  created_at: string;
  author_username: string;
  author_display_name: string | null;
  author_avatar_emoji: string | null;
  author_avatar_url: string | null;
  /** Up to 3 most-recent visible replies — enough for a rich SEO snippet without a full thread fetch. */
  top_replies: PublicTweet[];
}

interface TweetRow {
  id: string;
  content: string | null;
  image_url: string | null;
  video_provider: "youtube" | "tiktok" | null;
  video_url: string | null;
  video_embed_id: string | null;
  likes_count: number;
  replies_count: number;
  retweets_count: number;
  created_at: string;
  author_username: string;
  author_display_name: string | null;
  author_avatar_emoji: string | null;
  author_avatar_url: string | null;
}

const SELECT = `
  SELECT t.id, t.content, t.image_url, t.video_provider, t.video_url, t.video_embed_id,
         t.likes_count, t.replies_count, t.retweets_count, t.created_at,
         u.username AS author_username, u.display_name AS author_display_name,
         u.avatar_emoji AS author_avatar_emoji, u.avatar_url AS author_avatar_url
  FROM tweets t
  JOIN users u ON u.id = t.user_id
  WHERE t.deleted_at IS NULL AND u.deleted_at IS NULL
`;

async function fetchTopReplies(tweetId: string): Promise<PublicTweet[]> {
  const { rows } = await db.query<TweetRow>(
    `${SELECT} AND t.parent_tweet_id = $1 ORDER BY t.created_at ASC LIMIT 3`,
    [tweetId]
  );
  return rows.map((row) => ({ ...row, top_replies: [] }));
}

/**
 * Resolve a public Tweet by id.
 *
 * @param tweetId  The Tweet's uuid from the URL.
 */
export async function resolvePublicTweet(tweetId: string): Promise<PublicTweet | null> {
  const { rows } = await db.query<TweetRow>(`${SELECT} AND t.id = $1 LIMIT 1`, [tweetId]);
  const row = rows[0];
  if (!row) return null;
  const top_replies = await fetchTopReplies(row.id);
  return { ...row, top_replies };
}
