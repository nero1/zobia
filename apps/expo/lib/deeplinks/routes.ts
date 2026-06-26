/**
 * Zobia Social — deep link route definitions.
 *
 * Single source of truth for every deep link / universal link the app handles.
 * Use the builder functions to generate typed URLs so route changes propagate
 * automatically.
 *
 * Custom scheme:      `zobia://`
 * Universal link host: env.WEB_BASE_URL (zobia.vercel.app today → zobia.org).
 *
 * Public, shareable, SEO-friendly URLs mirror the web app exactly:
 *   /u/<username>   profile
 *   /r/<slug>       room
 *   /c/<slug>       course / classroom
 *   /g/<slug>       game
 *
 * Internal app screens (e.g. /rooms/<uuid>) keep using the immutable UUID; the
 * universal-link redirect screens (app/r/[slug].tsx etc.) resolve a public
 * slug to its UUID and forward to the internal screen.
 */

import { env } from '@/lib/env';
import { appendReferralCode } from '@zobia/shared/utils';

/** Base custom scheme used in app.json. */
const SCHEME = 'zobia';

/** Universal-link host derived from the configured web base URL. */
const WEB_ORIGIN = env.WEB_BASE_URL.replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Route path constants
// ---------------------------------------------------------------------------

export const ROUTES = {
  // Auth
  LOGIN: '/auth/login',

  // Onboarding
  ONBOARDING: '/onboarding',
  ONBOARDING_VIBE_QUIZ: '/onboarding/vibe-quiz',
  ONBOARDING_WELCOME_DROP: '/onboarding/welcome-drop',

  // Main tabs
  HOME: '/(tabs)',
  ROOMS: '/(tabs)/rooms',
  MESSAGES: '/(tabs)/messages',
  GUILD: '/(tabs)/guild',
  PROFILE: '/(tabs)/profile',

  // Internal dynamic screens (UUID-addressed).
  // BUG-DATA-05 FIX: encode path segments so any non-UUID identifier (e.g.
  // slugs with slashes or special chars) doesn't corrupt the URL structure.
  ROOM: (id: string) => `/rooms/${encodeURIComponent(id)}`,
  GUILD_DETAIL: (id: string) => `/guilds/${encodeURIComponent(id)}`,
  MESSAGE_THREAD: (threadId: string) => `/messages/${encodeURIComponent(threadId)}`,
} as const;

// ---------------------------------------------------------------------------
// Public (shareable) path builders — match the web app's SEO scheme.
// ---------------------------------------------------------------------------

export const PUBLIC_PATHS = {
  profile: (username: string) => `/u/${encodeURIComponent(username)}`,
  room: (slug: string) => `/r/${encodeURIComponent(slug)}`,
  course: (slug: string) => `/c/${encodeURIComponent(slug)}`,
  game: (slug: string) => `/g/${encodeURIComponent(slug)}`,
} as const;

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/**
 * Build a `zobia://` deep link URL for in-app navigation.
 *
 * @example deepLink(ROUTES.ROOM('abc123')) // "zobia://rooms/abc123"
 */
export function deepLink(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${SCHEME}://${clean}`;
}

/**
 * Build a public, shareable universal link on the web origin.
 *
 * @example universalLink(PUBLIC_PATHS.profile('alice'))
 *   // "https://zobia.vercel.app/u/alice"
 */
export function universalLink(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${WEB_ORIGIN}${clean}`;
}

/**
 * Build a shareable universal link with a referral code attached, e.g. for a
 * "share my profile / room / game" action. Works for any public path.
 *
 * @example referralLink(PUBLIC_PATHS.game('tapontap'), '8732623')
 *   // "https://zobia.vercel.app/g/tapontap?r=8732623"
 */
export function referralLink(path: string, referralCode: string | null | undefined): string {
  return appendReferralCode(universalLink(path), referralCode);
}
