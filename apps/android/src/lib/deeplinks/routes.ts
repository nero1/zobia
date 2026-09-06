/**
 * apps/android/src/lib/deeplinks/routes.ts
 *
 * Adapted from apps/expo/lib/deeplinks/routes.ts.
 * Changes: env source from import.meta.env (Vite) instead of expo-constants.
 * All ROUTES, PUBLIC_PATHS, deepLink/universalLink/referralLink functions kept identical.
 */

import { env } from '@/lib/env';
import { appendReferralCode } from '@zobia/shared/utils';

const SCHEME = 'zobia';
const WEB_ORIGIN = env.VITE_WEB_BASE_URL.replace(/\/$/, '');

export const ROUTES = {
  LOGIN: '/auth/login',
  REGISTER: '/auth/register',
  HOME: '/home',
  ROOMS: '/rooms',
  MESSAGES: '/messages',
  NOTIFICATIONS: '/notifications',
  SETTINGS: '/settings',
  ROOM: (id: string) => `/rooms/${encodeURIComponent(id)}`,
  MESSAGE_THREAD: (threadId: string) => `/messages/${encodeURIComponent(threadId)}`,
  PROFILE: (username: string) => `/profile/${encodeURIComponent(username)}`,
  GAME: (slug: string) => `/games/${encodeURIComponent(slug)}`,
  // No standalone /gift/:userId screen — mirrors web's app/(app)/gift/[userId]/page.tsx,
  // which just resolves the recipient's username and redirects into the Gifts Hub send
  // flow. The inbound zobia://gift/:userId link is handled in routes/__root.tsx's
  // appUrlOpen listener, which does the same resolve-then-navigate-to-/gifts?recipientId=
  // &username= that the web redirect does.
  GIFT: (userId: string) => `/gift/${encodeURIComponent(userId)}`,
  // Support Tickets — mirrors apps/web/lib/deeplinks/routes.ts.
  SUPPORT: '/support',
  SUPPORT_NEW: '/support/new',
  SUPPORT_TICKET: (ticketId: string) => `/support/${encodeURIComponent(ticketId)}`,
  // Help Center — public browsing, no auth wall (mirrors web's /help/*).
  HELP: '/help',
  HELP_CATEGORY: (categorySlug: string) => `/help/${encodeURIComponent(categorySlug)}`,
  HELP_DOC: (categorySlug: string, docSlug: string) => `/help/${encodeURIComponent(categorySlug)}/${encodeURIComponent(docSlug)}`,
} as const;

export const PUBLIC_PATHS = {
  profile: (username: string) => `/u/${encodeURIComponent(username)}`,
  room: (slug: string) => `/r/${encodeURIComponent(slug)}`,
  course: (slug: string) => `/c/${encodeURIComponent(slug)}`,
  game: (slug: string) => `/g/${encodeURIComponent(slug)}`,
  // Help Center doc/category pages are public on web too — included here so
  // the inbound zobia://help/... universal link resolves without an auth check.
  help: (categorySlug: string) => `/help/${encodeURIComponent(categorySlug)}`,
  helpDoc: (categorySlug: string, docSlug: string) => `/help/${encodeURIComponent(categorySlug)}/${encodeURIComponent(docSlug)}`,
} as const;

export function deepLink(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${SCHEME}://${clean}`;
}

export function universalLink(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${WEB_ORIGIN}${clean}`;
}

export function referralLink(path: string, referralCode: string | null | undefined): string {
  return appendReferralCode(universalLink(path), referralCode);
}

/**
 * The OAuth callback target used by both Login and Register.
 *
 * This must be the verified HTTPS Android App Link (`universalLink('/auth/callback')`),
 * never the `zobia://` custom scheme — a custom scheme can be registered by any other
 * installed app, which opens an OAuth-code-interception window. Exporting this as a
 * single shared constant (rather than each screen hardcoding its own) prevents the two
 * screens from drifting apart, as previously happened when only Login was patched.
 */
export const OAUTH_CALLBACK_LINK = universalLink('/auth/callback');
