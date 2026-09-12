/**
 * lib/feed/deeplink.ts
 *
 * Best-effort deep-link path per boostable/feed content type. Shared by the
 * Home Feed aggregator (lib/feed/aggregator.ts) and the content-boost route
 * (app/api/content/boost) so a boosted item's ad-creative click_url and its
 * Home Feed card link to the same place.
 *
 * Exact route slugs may differ per surface (web vs. Capacitor) — the Home
 * Dashboard UI work is expected to confirm/override these if they differ
 * from what's guessed here.
 */

import type { FeedContentType } from "./types";

export function deepLinkPathFor(contentType: FeedContentType, contentId: string): string {
  switch (contentType) {
    case "moment": return `/moments/${contentId}`;
    case "tweet": return `/tweets/${contentId}`;
    case "blog_post": return `/blog/post/${contentId}`;
    case "forum_thread": return `/f/thread/${contentId}`;
    case "forum_question": return `/answers/${contentId}`;
    case "room": return `/rooms/${contentId}`;
    case "classroom": return `/rooms/${contentId}`;
    case "wiki_page": return `/w/page/${contentId}`;
    case "game": return `/games/${contentId}`;
    case "business_page_post": return `/business/post/${contentId}`;
  }
}
