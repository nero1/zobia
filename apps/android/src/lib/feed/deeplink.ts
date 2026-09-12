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
 *    wiki_page (/wiki-pages/<id>), business_page_post (/business-posts/<id>):
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
