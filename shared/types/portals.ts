/**
 * shared/types/portals.ts
 *
 * Wire types for Hashtags + Portals (/h/<slug>), shared by the web app, the
 * PWA and the Capacitor Android app so all three render identical payloads.
 */

export type PortalStatus = "official" | "auto" | "archived" | "suppressed";

/**
 * A portal page can also be a "tag page": a hashtag that has content but no
 * portal row (yet). It renders with the same template but is read-only (no
 * follow, no admin copy) and noindex.
 */
export type PortalPageStatus = PortalStatus | "tag";

export type PortalSectionKey =
  | "feed"
  | "rooms"
  | "guilds"
  | "people"
  | "forum"
  | "wiki"
  | "questions"
  | "blogs"
  | "polls";

export interface PortalSectionConfig {
  key: PortalSectionKey;
  enabled: boolean;
}

/** Compact portal card — discovery lists, feed suggestions, search. */
export interface PortalCard {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  coverImageUrl: string | null;
  accentColor: string | null;
  status: PortalPageStatus;
  followerCount: number;
  /** Tagged posts in the trending window (0 when unknown). */
  activityCount: number;
  /** Admin-boosted or sponsored right now — render a "Promoted" tag. */
  isPromoted: boolean;
  sponsorName: string | null;
}

export interface PortalFeedItem {
  contentType: string;
  contentId: string;
  authorId: string | null;
  title: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  url: string;
  createdAt: string;
  metrics?: Record<string, number>;
}

export interface PortalRoomCard {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  coverEmoji: string | null;
  memberCount: number;
  isClassroom: boolean;
}

export interface PortalGuildCard {
  id: string;
  name: string;
  crestEmoji: string;
  description: string | null;
  city: string | null;
  memberCount: number;
}

export interface PortalPersonCard {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string | null;
  avatarUrl: string | null;
  postCount: number;
}

export interface PortalForumBoard {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  threadCount: number;
}

export interface PortalSections {
  feed: PortalFeedItem[];
  rooms: PortalRoomCard[];
  guilds: PortalGuildCard[];
  people: PortalPersonCard[];
  forumBoard: PortalForumBoard | null;
  forum: PortalFeedItem[];
  wiki: PortalFeedItem[];
  questions: PortalFeedItem[];
  blogs: PortalFeedItem[];
  polls: PortalFeedItem[];
}

export interface PortalPayload {
  portal: PortalCard & {
    description: string | null;
    city: string | null;
    sections: PortalSectionConfig[];
    hashtag: string;
    isPinned: boolean;
    createdAt: string;
  };
  sections: PortalSections;
  /** ISO timestamp of when this payload was built (cache freshness). */
  generatedAt: string;
}

export interface PortalFeedPage {
  items: PortalFeedItem[];
  nextCursor: string | null;
}

/** Attached to a FeedPage when a "Portals for you" card should render. */
export interface PortalSuggestion {
  /** Insert the card after this many items of the page (0-based count). */
  afterIndex: number;
  portals: PortalCard[];
}

/** A trending hashtag chip on the discovery hub (with or without a portal). */
export interface TrendingTag {
  slug: string;
  postCount: number;
  authorCount: number;
  hasPortal: boolean;
}

/** One cached payload behind the /h discovery hub. */
export interface PortalDiscover {
  featured: PortalCard[];
  trendingTags: TrendingTag[];
  rising: PortalCard[];
  places: PortalCard[];
  newest: PortalCard[];
  popular: PortalCard[];
  generatedAt: string;
}
