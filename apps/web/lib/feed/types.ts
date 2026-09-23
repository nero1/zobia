/**
 * lib/feed/types.ts
 *
 * Shared types for the Home Dashboard feed (lib/feed/*, app/api/feed/*,
 * app/api/cron/feed-refresh).
 */

export type FeedTab = "for_you" | "trending" | "friends" | "new";

/** Every content type the Home Feed can surface — mirrors lib/ads/repo.ts BoostableContentType. */
export type FeedContentType =
  | "moment"
  | "tweet"
  | "blog_post"
  | "forum_thread"
  | "forum_question"
  | "room"
  | "wiki_page"
  | "game"
  | "classroom"
  | "business_page_post"
  | "poll"
  | "quiz";

/**
 * Which ranking tier an item was sourced from (see lib/feed/ranking.ts).
 * Higher number = higher priority tier. Used only for debugging/analytics —
 * the client never needs to branch on this.
 */
export type FeedTier =
  | "boosted"
  | "organic_popular"
  | "organic_trending"
  | "business"
  | "in_house_boosted"
  | "interest"
  | "recency";

/** A single Home Feed card — content-type-agnostic, no user-specific fields baked in. */
export interface FeedItem {
  contentType: FeedContentType;
  contentId: string;
  authorId: string | null;
  title: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  /** Relative deep-link path, e.g. "/tweets/<id>". */
  url: string;
  createdAt: string;
  /**
   * Broad interest bucket(s) this item matches for tier-6 interest ranking
   * (see ranking.ts) — the content type itself, plus a category/tag column
   * when the content type has one (blog category, room category, game
   * category). No general-purpose content tagging system exists yet, so
   * this is a documented simplification — see ranking.ts header comment.
   */
  tags: string[];
  /** Raw popularity/engagement metric used to rank within a tier. */
  engagementScore: number;
  isBoosted: boolean;
  isInHouseBoosted: boolean;
  businessTier?: "starter" | "growth" | "enterprise" | string | null;
  metrics?: Record<string, number>;
  /** Internal — which tier produced this item. Not part of the public cursor contract. */
  tier: FeedTier;
  /** Internal — precomputed tierWeight*1e6 + inTierScore, used for stable sort/cursor. */
  finalScore: number;
}

export interface FeedPage {
  items: Omit<FeedItem, "tier" | "finalScore">[];
  nextCursor: string | null;
}

/** A precomputed, cacheable pool of candidate items for one tab (no user-specific data). */
export interface FeedCandidatePool {
  tab: FeedTab;
  computedAt: number;
  items: FeedItem[];
}
