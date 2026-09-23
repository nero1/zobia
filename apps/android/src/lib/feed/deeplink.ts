/**
 * apps/android/src/lib/feed/deeplink.ts
 *
 * Home Feed card navigation helper. GET /api/feed already computes
 * `FeedItem.url` server-side (apps/web/lib/feed/deeplink.ts's
 * deepLinkPathFor) — the same value for both web and Android since it's
 * the same backend endpoint — so the client never recomputes the path
 * itself, only decides HOW to navigate to it:
 *
 *  - tweet, forum_question, room, classroom, moment, game: these paths
 *    (/tweets/<id>, /answers/<id>, /rooms/<id>, /moments, /games) already
 *    exist as real in-app TanStack Router routes, so they navigate with the
 *    router exactly like BottomNav's `navigate({ to: item.href as never })`
 *    pattern.
 *
 *  - blog_post (/blog-posts/<id>), forum_thread (/forum-threads/<id>),
 *    wiki_page (/wiki-pages/<id>), business_page_post (/business-posts/<id>),
 *    poll (/polls/<id>), quiz (/quizzes/<id>):
 *    these are SLUG-keyed canonical pages on web, resolved via one-off
 *    server-side id->slug DB redirect shims added alongside the web Home
 *    Dashboard work (app/(app)/blog-posts/[id]/page.tsx etc. — see
 *    apps/web/lib/feed/deeplink.ts's header comment). No client-callable
 *    JSON id->slug API exists for the Android app's own router to resolve
 *    these natively, so this app mirrors them as thin routes
 *    (routes/blog-posts/$id.tsx etc.) that hand off to the same web redirect
 *    shim via the in-app Browser — matching the existing
 *    `Browser.open({ url: `${env.VITE_WEB_BASE_URL}/...` })` pattern already
 *    used elsewhere (see routes/admin/rooms.tsx). This is a documented
 *    simplification: revisit with a native in-app landing page if/when a
 *    JSON id->slug lookup API ships.
 */

import type { FeedContentType } from './types';

const IN_APP_ROUTE_CONTENT_TYPES: ReadonlySet<FeedContentType> = new Set([
  'tweet',
  'forum_question',
  'room',
  'classroom',
  'moment',
  'game',
]);

/** True when `item.url` is a real in-app TanStack Router route (navigate with the router). */
export function isInAppFeedRoute(contentType: FeedContentType): boolean {
  return IN_APP_ROUTE_CONTENT_TYPES.has(contentType);
}

/** Where an unrecognised/missing content type navigates to. */
const FALLBACK_PATH = '/home';

/**
 * Resolve a feed card's navigation path, mirroring apps/web's
 * deepLinkPathFor. MUST always return a non-empty string.
 *
 * The server already computes `FeedItem.url`, but it is a raw string over
 * the wire: a server-side `undefined` is dropped entirely by JSON.stringify,
 * so the field can simply be absent. Passing that undefined straight into a
 * router Link is what blanked the web Home Dashboard (see the note in
 * apps/web/lib/feed/deeplink.ts), so resolve defensively here too instead of
 * trusting the payload.
 */
export function feedItemPath(contentType: FeedContentType, contentId: string, url?: string | null): string {
  if (typeof url === 'string' && url) return url;
  switch (contentType) {
    case 'moment': return '/moments';
    case 'tweet': return `/tweets/${contentId}`;
    case 'blog_post': return `/blog-posts/${contentId}`;
    case 'forum_thread': return `/forum-threads/${contentId}`;
    case 'forum_question': return `/answers/${contentId}`;
    case 'room': return `/rooms/${contentId}`;
    case 'classroom': return `/classroom/${contentId}`;
    case 'wiki_page': return `/wiki-pages/${contentId}`;
    case 'game': return '/games';
    case 'business_page_post': return `/business-posts/${contentId}`;
    case 'poll': return `/polls/${contentId}`;
    case 'quiz': return `/quizzes/${contentId}`;
    default: return FALLBACK_PATH;
  }
}
