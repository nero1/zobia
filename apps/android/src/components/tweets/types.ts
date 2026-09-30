/**
 * apps/android/src/components/tweets/types.ts
 *
 * Mirrors apps/web/components/tweets/types.ts.
 */

export type TweetVideoProvider = 'youtube' | 'tiktok';

export interface Tweet {
  id: string;
  authorId: string;
  authorUsername: string;
  authorAvatarEmoji: string;
  authorIsVerified: boolean;
  authorPrestigeCount: number;
  authorXpTotal: string | number;
  parentTweetId: string | null;
  content: string | null;
  imageUrl: string | null;
  videoProvider: TweetVideoProvider | null;
  videoUrl: string | null;
  videoEmbedId: string | null;
  isPinned: boolean;
  likesCount: number;
  repliesCount: number;
  retweetsCount: number;
  liked: boolean;
  retweeted: boolean;
  /** How many times the viewer has retweeted this Tweet (0/1 unless it is their own). */
  myRetweets?: number;
  /** Set only on the viewer's own Tweets: max times they may retweet it. */
  selfRetweetCap?: number | null;
  /** True when a higher plan would raise selfRetweetCap (drives the upgrade prompt). */
  selfRetweetCanUpgrade?: boolean;
  retweetedById: string | null;
  retweetedByUsername: string | null;
  retweetQuoteContent: string | null;
  createdAt: string;
  /** Unique per feed row (a tweet and its retweets share `id`); use for list keys. */
  feedId?: string;
}

export interface TweetRow {
  id: string;
  user_id: string;
  parent_tweet_id: string | null;
  username: string;
  avatar_emoji: string | null;
  is_verified: boolean | null;
  prestige_count: number | null;
  xp_total: string | number | null;
  content: string | null;
  image_url: string | null;
  video_provider: TweetVideoProvider | null;
  video_url: string | null;
  video_embed_id: string | null;
  is_pinned: boolean;
  likes_count: number;
  replies_count: number;
  retweets_count: number;
  liked: boolean;
  retweeted: boolean;
  my_retweets?: number;
  self_retweet_cap?: number | null;
  self_retweet_can_upgrade?: boolean;
  retweeted_by_id: string | null;
  retweeted_by_username: string | null;
  retweet_quote_content: string | null;
  created_at: string;
  activity_at?: string;
  feed_id?: string;
}

export function mapTweet(row: TweetRow): Tweet {
  return {
    id: row.id,
    authorId: row.user_id,
    authorUsername: row.username,
    authorAvatarEmoji: row.avatar_emoji || '👤',
    authorIsVerified: Boolean(row.is_verified),
    authorPrestigeCount: row.prestige_count ?? 0,
    authorXpTotal: row.xp_total ?? 0,
    parentTweetId: row.parent_tweet_id ?? null,
    content: row.content,
    imageUrl: row.image_url,
    videoProvider: row.video_provider,
    videoUrl: row.video_url,
    videoEmbedId: row.video_embed_id,
    isPinned: Boolean(row.is_pinned),
    likesCount: row.likes_count ?? 0,
    repliesCount: row.replies_count ?? 0,
    retweetsCount: row.retweets_count ?? 0,
    liked: Boolean(row.liked),
    retweeted: Boolean(row.retweeted),
    myRetweets: row.my_retweets ?? (row.retweeted ? 1 : 0),
    selfRetweetCap: row.self_retweet_cap ?? null,
    selfRetweetCanUpgrade: Boolean(row.self_retweet_can_upgrade),
    retweetedById: row.retweeted_by_id ?? null,
    retweetedByUsername: row.retweeted_by_username ?? null,
    retweetQuoteContent: row.retweet_quote_content ?? null,
    createdAt: row.activity_at ?? row.created_at,
    feedId: row.feed_id ?? row.id,
  };
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export interface RetweetResult {
  retweetsCount: number;
  retweeted: boolean;
  myRetweets: number;
}

/** The viewer's live retweet count for a Tweet, tolerating rows without `myRetweets`. */
export function myRetweetCount(tw: Tweet): number {
  return tw.myRetweets ?? (tw.retweeted ? 1 : 0);
}

/**
 * Optimistic local update. `undo` = true removes one of the viewer's
 * retweets, false adds one. Reverting is the same call with `!undo`.
 */
export function optimisticRetweet(tw: Tweet, undo: boolean): Tweet {
  const mine = Math.max(0, myRetweetCount(tw) + (undo ? -1 : 1));
  return { ...tw, myRetweets: mine, retweeted: mine > 0, retweetsCount: Math.max(0, tw.retweetsCount + (undo ? -1 : 1)) };
}

/** Replaces the optimistic guess with the server's authoritative numbers. */
export function applyRetweetResult(tw: Tweet, r: RetweetResult): Tweet {
  return { ...tw, myRetweets: r.myRetweets, retweeted: r.retweeted, retweetsCount: r.retweetsCount };
}
