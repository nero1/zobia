/**
 * apps/android/src/lib/notifications/routing.ts
 *
 * Shared "server-controlled data must resolve to a safe in-app route"
 * allowlist — originally lived only in lib/push/index.ts (used by the push
 * notification tap handler), moved here (ZSB-16) so the in-app notifications
 * list (routes/notifications.tsx) can reuse the exact same allowlist instead
 * of inventing a second one. lib/push/index.ts re-exports `isAllowedRoute`
 * for backwards compatibility with its existing unit tests.
 */

/**
 * Allowlist of in-app routes a notification's `action`/`actionUrl` may
 * navigate to — scoped to routes that actually exist in this app's
 * routeTree.gen.ts (narrower than web's equivalent list since not every
 * web/PWA page has an Android screen yet). Prevents a compromised/crafted
 * notification payload from routing into an arbitrary path.
 */
export const VALID_PUSH_ROUTES: RegExp[] = [
  /^\/rooms\/[a-f0-9-]+$/i,
  /^\/rooms$/i,
  /^\/messages\/[a-f0-9-]+$/i,
  /^\/messages$/i,
  /^\/profile\/[^/]+$/i,
  /^\/games\/[a-z0-9-]+$/i,
  /^\/answers\/[a-f0-9-]+$/i,
  /^\/blogs\/[^/]+\/[^/]+$/i,
  /^\/business$/i,
  /^\/business\/ads$/i,
  /^\/notifications$/i,
  /^\/wallet$/i,
  /^\/home$/i,
  /^\/nemesis$/i,
  /^\/friends$/i,
  /^\/guilds$/i,
  /^\/inbox$/i,
  /^\/seasons$/i,
  /^\/council$/i,
  // ZSB-16 additions: routes deriveNotificationActionUrl (web) can produce
  // that weren't previously reachable from a push/notification tap.
  /^\/gifts$/i,
  /^\/referrals$/i,
  /^\/events$/i,
  /^\/kyc$/i,
];

/**
 * Non-path action tokens the backend sends alongside/instead of a route
 * (e.g. lib/notifications/reengagement.ts, cron/daily-notify's Platform
 * Council invite) — mapped to the in-app route they should open.
 */
export const ACTION_ALIASES: Record<string, string> = {
  open_council: '/council',
  '/economy/coins': '/wallet',
};

export function isAllowedRoute(path: string): boolean {
  return VALID_PUSH_ROUTES.some((re) => re.test(path));
}

/**
 * Resolve a raw action token (route path or alias) from server data into a
 * safe, allowlisted in-app route, or `null` if it isn't recognised/allowed.
 */
export function resolveNotificationRoute(action: string | null | undefined): string | null {
  if (!action) return null;
  const route = ACTION_ALIASES[action] ?? action;
  return isAllowedRoute(route) ? route : null;
}
