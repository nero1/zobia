/**
 * apps/web/lib/public/resolveTweet.ts
 *
 * Resolves a public Tweet by id for the crawlable SSR page (/t/<tweetId>).
 * Mirrors lib/public/resolveForumQuestion.ts's shape, minus the slug/legacy-
 * redirect handling — Tweets have no slug (see db/migrations/0001_consolidated_schema.sql),
 * they're addressed by uuid everywhere, in-app and here.
 *
 * Only non-deleted Tweets authored by a non-deleted user are returned, so
 * removed content never leaks to crawlers or logged-out visitors.
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { and, asc, eq, isNull } from "drizzle-orm";

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

function selectTweetColumns() {
  return {
    id: schema.tweets.id,
    content: schema.tweets.content,
    imageUrl: schema.tweets.imageUrl,
    videoProvider: schema.tweets.videoProvider,
    videoUrl: schema.tweets.videoUrl,
    videoEmbedId: schema.tweets.videoEmbedId,
    likesCount: schema.tweets.likesCount,
    repliesCount: schema.tweets.repliesCount,
    retweetsCount: schema.tweets.retweetsCount,
    createdAt: schema.tweets.createdAt,
    authorUsername: schema.users.username,
    authorDisplayName: schema.users.displayName,
    authorAvatarEmoji: schema.users.avatarEmoji,
    authorAvatarUrl: schema.users.avatarUrl,
  };
}

interface TweetSelectRow {
  id: string;
  content: string | null;
  imageUrl: string | null;
  videoProvider: string | null;
  videoUrl: string | null;
  videoEmbedId: string | null;
  likesCount: number;
  repliesCount: number;
  retweetsCount: number;
  createdAt: Date;
  authorUsername: string;
  authorDisplayName: string | null;
  authorAvatarEmoji: string | null;
  authorAvatarUrl: string | null;
}

function toPublicTweet(row: TweetSelectRow): Omit<PublicTweet, "top_replies"> {
  return {
    id: row.id,
    content: row.content,
    image_url: row.imageUrl,
    video_provider: row.videoProvider as "youtube" | "tiktok" | null,
    video_url: row.videoUrl,
    video_embed_id: row.videoEmbedId,
    likes_count: row.likesCount,
    replies_count: row.repliesCount,
    retweets_count: row.retweetsCount,
    created_at: row.createdAt.toISOString(),
    author_username: row.authorUsername,
    author_display_name: row.authorDisplayName,
    author_avatar_emoji: row.authorAvatarEmoji,
    author_avatar_url: row.authorAvatarUrl,
  };
}

async function fetchTopReplies(tweetId: string): Promise<PublicTweet[]> {
  const orm = await getDb();
  const rows = await orm
    .select(selectTweetColumns())
    .from(schema.tweets)
    .innerJoin(schema.users, eq(schema.users.id, schema.tweets.userId))
    .where(
      and(isNull(schema.tweets.deletedAt), isNull(schema.users.deletedAt), eq(schema.tweets.parentTweetId, tweetId))
    )
    .orderBy(asc(schema.tweets.createdAt))
    .limit(3);
  return rows.map((row) => ({ ...toPublicTweet(row), top_replies: [] }));
}

/**
 * Resolve a public Tweet by id.
 *
 * @param tweetId  The Tweet's uuid from the URL.
 */
export async function resolvePublicTweet(tweetId: string): Promise<PublicTweet | null> {
  const orm = await getDb();
  const [row] = await orm
    .select(selectTweetColumns())
    .from(schema.tweets)
    .innerJoin(schema.users, eq(schema.users.id, schema.tweets.userId))
    .where(and(isNull(schema.tweets.deletedAt), isNull(schema.users.deletedAt), eq(schema.tweets.id, tweetId)))
    .limit(1);
  if (!row) return null;
  const top_replies = await fetchTopReplies(row.id);
  return { ...toPublicTweet(row), top_replies };
}
