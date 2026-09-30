/**
 * components/tweets/types.ts
 *
 * Shared Tweet client shape + row mapper, used by the feed, the composer's
 * preview, profile integration, and the single-tweet deep link page.
 */

export type TweetVideoProvider = "youtube" | "tiktok";

export interface Tweet {
  id: string;
  authorId: string;
  authorUsername: string;
  authorAvatarEmoji: string;
  authorAvatarUrl?: string | null;
  authorIsVerified?: boolean;
  authorPrestigeCount?: number;
  authorXpTotal?: string | number;
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
  /** Set when this row is a retweet-attributed feed item, not an original post. */
  retweetedById: string | null;
  retweetedByUsername: string | null;
  retweetQuoteContent: string | null;
  createdAt: string;
  /** Unique per feed row (a tweet and its retweets share `id`); use for React keys. */
  feedId?: string;
}

/** Maps a raw API row (snake_case) to the client Tweet shape. */
export function mapTweetRow(r: Record<string, unknown>): Tweet {
  return {
    id: r.id as string,
    authorId: r.user_id as string,
    authorUsername: r.username as string,
    authorAvatarEmoji: (r.avatar_emoji as string) || "👤",
    authorAvatarUrl: (r.avatar_url ?? null) as string | null,
    authorIsVerified: Boolean(r.is_verified),
    authorPrestigeCount: (r.prestige_count ?? 0) as number,
    authorXpTotal: (r.xp_total ?? 0) as string | number,
    parentTweetId: (r.parent_tweet_id ?? null) as string | null,
    content: (r.content ?? null) as string | null,
    imageUrl: (r.image_url ?? null) as string | null,
    videoProvider: (r.video_provider ?? null) as TweetVideoProvider | null,
    videoUrl: (r.video_url ?? null) as string | null,
    videoEmbedId: (r.video_embed_id ?? null) as string | null,
    isPinned: Boolean(r.is_pinned),
    likesCount: (r.likes_count ?? 0) as number,
    repliesCount: (r.replies_count ?? 0) as number,
    retweetsCount: (r.retweets_count ?? 0) as number,
    liked: Boolean(r.liked),
    retweeted: Boolean(r.retweeted),
    myRetweets: Number(r.my_retweets ?? (r.retweeted ? 1 : 0)),
    selfRetweetCap: r.self_retweet_cap == null ? null : Number(r.self_retweet_cap),
    retweetedById: (r.retweeted_by_id ?? null) as string | null,
    retweetedByUsername: (r.retweeted_by_username ?? null) as string | null,
    retweetQuoteContent: (r.retweet_quote_content ?? null) as string | null,
    createdAt: (r.activity_at ?? r.created_at) as string,
    feedId: ((r.feed_id ?? r.id) as string),
  };
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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

/**
 * Sends a retweet / quote-retweet / un-retweet request. Resolves the server's
 * authoritative `{ retweetsCount, retweeted }`, or null when the request
 * failed (network error or non-2xx, e.g. retweeting your own tweet).
 */
export async function sendRetweet(
  tweetId: string,
  retweeted: boolean,
  quoteContent?: string
): Promise<RetweetResult | null> {
  try {
    const res = await fetch(`/api/tweets/${tweetId}/retweet`, {
      method: retweeted ? "DELETE" : "POST",
      credentials: "include",
      ...(retweeted
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(quoteContent ? { quoteContent } : {}) }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Partial<RetweetResult> };
    const myRetweets = json.data?.myRetweets ?? (retweeted ? 0 : 1);
    return { retweetsCount: json.data?.retweetsCount ?? 0, retweeted: myRetweets > 0, myRetweets };
  } catch {
    return null;
  }
}
