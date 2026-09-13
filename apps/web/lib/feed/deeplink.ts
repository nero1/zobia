/**
 * lib/feed/deeplink.ts
 *
 * Best-effort deep-link path per boostable/feed content type. Shared by the
 * Home Feed aggregator (lib/feed/aggregator.ts) and the content-boost route
 * (app/api/content/boost) so a boosted item's ad-creative click_url and its
 * Home Feed card link to the same place.
 *
 * VERIFIED against the actual route files in app/(app)/* and app/* as part
 * of the Home Dashboard UI work (2026-09):
 *
 *  - tweet           -> /tweets/<id>                       app/(app)/tweets/[tweetId]/page.tsx (id-keyed, exact)
 *  - forum_question  -> /answers/<id>                      app/(app)/answers/[id]/page.tsx (id-keyed, exact)
 *  - room            -> /rooms/<id>                        app/(app)/rooms/[roomId]/page.tsx (id-keyed, exact)
 *  - classroom       -> /rooms/<id>                        classrooms ARE rooms (rooms.type = 'classroom', see
 *                                                           lib/feed/aggregator.ts POPULAR_SOURCES) with no separate
 *                                                           detail route — /rooms/[roomId]/page.tsx renders them.
 *
 *  The following canonical pages are SLUG-keyed, not id-keyed, and the feed
 *  aggregator's candidate queries only select the row id (see
 *  RawCandidateRow in aggregator.ts) — so an id can't be turned into the
 *  right slug(s) synchronously here. Rather than widen every candidate query
 *  (and re-plumb FeedItem) to carry slugs, each of these routes to a small
 *  server redirect shim added alongside this fix that does one id->slug(s)
 *  DB lookup and 307s to the canonical URL:
 *  - blog_post        -> /blog-posts/<id>    -> redirects to /b/<blogSlug>/<postSlug>   (app/(app)/blog-posts/[id]/page.tsx)
 *  - forum_thread     -> /forum-threads/<id> -> redirects to /f/<threadSlug>            (app/(app)/forum-threads/[id]/page.tsx)
 *  - wiki_page        -> /wiki-pages/<id>    -> redirects to /wiki/<wikiSlug>/<pageSlug> (app/(app)/wiki-pages/[id]/page.tsx)
 *
 *  business_page_post has no standalone detail page at all (posts render
 *  inline on the business page) — /business-posts/<id> looks up the owning
 *  page and redirects to /business/pages/<pageId>?post=<id>
 *  (app/(app)/business-posts/[id]/page.tsx).
 *
 *  moment and game have NO per-item detail route in the app at all (moments
 *  render only inline in the /moments wall feed; games only have list/detail
 *  via modal-less browse pages under /games) — these link to their list page.
 *  This is a documented simplification, not a guess: revisit if/when a
 *  single-moment or single-game page ships.
 */

import type { FeedContentType } from "./types";

/** Where an unrecognised content type links to. Never an empty string or
 *  undefined — see the exhaustiveness note on deepLinkPathFor below. */
const FALLBACK_PATH = "/home";

/**
 * MUST always return a non-empty string.
 *
 * `contentType` is typed as FeedContentType, but at runtime it is a raw
 * string read straight out of Postgres — `content_type` literals in the
 * aggregator's UNION queries, and crucially `ad_campaigns.boosted_content_type`,
 * which is a free-text column. A value outside the union (an older row, a
 * content type added to the boost flow before this map, a typo) therefore
 * reaches this switch even though TypeScript believes it cannot.
 *
 * Without the default clause the switch returned `undefined` for such a
 * value, which flowed through FeedItem.url into `<Link href={undefined}>`.
 * Next.js's internal formatUrl() does `let { auth, hostname } = urlObj`, so
 * an undefined href threw "Cannot destructure property 'auth' of 'e' as it
 * is undefined" (Chrome) / "TypeError: e is undefined" (Firefox) from inside
 * Next's own frames, blanking the whole Home Dashboard. Keep this total.
 */
export function deepLinkPathFor(contentType: FeedContentType, contentId: string): string {
  switch (contentType) {
    case "moment": return `/moments`;
    case "tweet": return `/tweets/${contentId}`;
    case "blog_post": return `/blog-posts/${contentId}`;
    case "forum_thread": return `/forum-threads/${contentId}`;
    case "forum_question": return `/answers/${contentId}`;
    case "room": return `/rooms/${contentId}`;
    case "classroom": return `/rooms/${contentId}`;
    case "wiki_page": return `/wiki-pages/${contentId}`;
    case "game": return `/games`;
    case "business_page_post": return `/business-posts/${contentId}`;
    default: return FALLBACK_PATH;
  }
}
