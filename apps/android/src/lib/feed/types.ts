/**
 * apps/android/src/lib/feed/types.ts
 *
 * Client-side shape of GET /api/feed items, mirrored from
 * apps/web/lib/feed/types.ts FeedItem/FeedPage (the backend response shape
 * is shared across web and Android — same endpoint, same JSON). Only the
 * fields the client actually renders/needs are kept here; server-internal
 * fields (tier, finalScore) are omitted just like web's FeedPage type.
 */

export type FeedTab = 'for_you' | 'trending' | 'friends' | 'new';

export type FeedContentType =
  | 'moment'
  | 'tweet'
  | 'blog_post'
  | 'forum_thread'
  | 'forum_question'
  | 'room'
  | 'wiki_page'
  | 'game'
  | 'classroom'
  | 'business_page_post';

export interface FeedItem {
  contentType: FeedContentType;
  contentId: string;
  authorId: string | null;
  title: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  /** Relative deep-link path, e.g. "/tweets/<id>" — computed server-side, same as web. */
  url: string;
  createdAt: string;
  tags: string[];
  engagementScore: number;
  isBoosted: boolean;
  isInHouseBoosted: boolean;
  businessTier?: 'starter' | 'growth' | 'enterprise' | string | null;
  metrics?: Record<string, number>;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}
