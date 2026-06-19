/**
 * shared/utils/publicRoutes.ts
 *
 * Canonical public-facing URL path builders, shared by web, PWA and Expo so
 * every client agrees on the SEO-friendly scheme:
 *
 *   /u/<username>        — public profile
 *   /r/<room-slug>       — public room
 *   /c/<course-slug>     — classroom / course
 *   /g/<game-slug>       — game
 *
 * These return PATHS (leading slash, no origin). Prefix with an origin for an
 * absolute URL, and pipe through appendReferralCode() to attach `?r=`.
 */

export const PUBLIC_ROUTE_PREFIXES = {
  profile: "/u",
  room: "/r",
  course: "/c",
  game: "/g",
} as const;

export function profilePath(username: string): string {
  return `${PUBLIC_ROUTE_PREFIXES.profile}/${encodeURIComponent(username)}`;
}

export function roomPath(slug: string): string {
  return `${PUBLIC_ROUTE_PREFIXES.room}/${encodeURIComponent(slug)}`;
}

export function coursePath(slug: string): string {
  return `${PUBLIC_ROUTE_PREFIXES.course}/${encodeURIComponent(slug)}`;
}

export function gamePath(slug: string): string {
  return `${PUBLIC_ROUTE_PREFIXES.game}/${encodeURIComponent(slug)}`;
}
