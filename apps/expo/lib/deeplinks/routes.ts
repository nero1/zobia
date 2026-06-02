/**
 * Zobia Social — deep link route definitions.
 *
 * This is the single source of truth for every deep link / universal link
 * the app handles.  Use the builder functions to generate typed URLs so
 * that route changes propagate automatically.
 *
 * Scheme: `zobia://`
 * Universal link host: `zobia.app`
 */

/** Base custom scheme used in app.json. */
const SCHEME = 'zobia';

/** Universal link host (must match android.intentFilters in app.json). */
const HOST = 'zobia.app';

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

  // Dynamic routes (use builder functions below)
  ROOM: (id: string) => `/rooms/${id}`,
  USER_PROFILE: (username: string) => `/users/${username}`,
  GUILD_DETAIL: (id: string) => `/guilds/${id}`,
  MESSAGE_THREAD: (threadId: string) => `/messages/${threadId}`,
} as const;

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/**
 * Build a `zobia://` deep link URL for in-app navigation.
 *
 * @param path  One of the static ROUTES values or a dynamic route string.
 *
 * @example
 * deepLink(ROUTES.ROOM('abc123'))
 * // => "zobia://rooms/abc123"
 */
export function deepLink(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${SCHEME}://${clean}`;
}

/**
 * Build a `https://zobia.app` universal link URL.
 *
 * @param path  Route path (with or without leading slash).
 *
 * @example
 * universalLink(ROUTES.USER_PROFILE('alice'))
 * // => "https://zobia.app/users/alice"
 */
export function universalLink(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `https://${HOST}${clean}`;
}
