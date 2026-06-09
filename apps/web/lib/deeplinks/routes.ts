/**
 * lib/deeplinks/routes.ts
 *
 * Deep link route map – single source of truth.
 *
 * All in-app navigation, push notification links, and external deep links
 * reference this map.  Never hardcode route strings elsewhere.
 *
 * Pattern conventions:
 *   - :param  → required dynamic segment
 *   - ?param  → optional query parameter (documented in comments)
 */

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

export const ROUTES = {
  // ---- Public / unauthenticated ------------------------------------------
  landing: "/",
  login: "/auth/login",
  register: "/auth/register",
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",   // ?token=xxx

  // ---- OAuth callbacks ----------------------------------------------------
  googleCallback: "/api/auth/google/callback",
  telegramCallback: "/api/auth/telegram/callback",

  // ---- Authenticated app -------------------------------------------------
  home: "/home",
  rooms: "/rooms",
  roomDetail: (roomId: string) => `/rooms/${roomId}`,
  messages: "/messages",
  conversation: (userId: string) => `/messages/${userId}`,
  profile: "/profile",
  userProfile: (username: string) => `/u/${username}`,
  notifications: "/notifications",
  search: "/search",
  rankings: "/rankings",
  gifts: "/gifts",
  settings: "/settings",
  settingsProfile: "/settings/profile",
  settingsPrivacy: "/settings/privacy",
  settingsNotifications: "/settings/notifications",
  settingsSecurity: "/settings/security",

  // ---- API routes ---------------------------------------------------------
  api: {
    authRefresh: "/api/auth/refresh",
    authLogout: "/api/auth/logout",
    users: "/api/users",
    userById: (id: string) => `/api/users/${id}`,
    rooms: "/api/rooms",
    roomById: (id: string) => `/api/rooms/${id}`,
    messages: "/api/messages",
    notifications: "/api/notifications",
    health: "/api/health",
    upload: "/api/upload",
  },

  // ---- Admin panel --------------------------------------------------------
  admin: {
    login: "/admin/login",
    dashboard: "/admin",
    users: "/admin/users",
    userDetail: (id: string) => `/admin/users/${id}`,
    rooms: "/admin/rooms",
    reports: "/admin/reports",
    settings: "/admin/settings",
    payments: "/admin/payments",
    analytics: "/admin/analytics",
    broadcast: "/admin/broadcast",
  },
} as const;

// ---------------------------------------------------------------------------
// Deep link scheme (for mobile app cross-linking)
// ---------------------------------------------------------------------------

/** Universal link / app scheme prefix for cross-platform deep links. */
export const DEEP_LINK_SCHEME = "zobia://";

/**
 * Build a universal deep link URL from an app route.
 *
 * @param path - App path (e.g. `ROUTES.roomDetail('abc')`)
 * @returns Full deep link string (e.g. `zobia:///rooms/abc`)
 */
export function buildDeepLink(path: string): string {
  return `${DEEP_LINK_SCHEME}${path.startsWith("/") ? path.slice(1) : path}`;
}

/**
 * Build a full HTTPS URL from an app path.
 * Uses NEXT_PUBLIC_APP_URL as the base.
 *
 * @param path - App path
 * @returns Full HTTPS URL
 */
export function buildWebUrl(path: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** All static (non-function) route string values. */
export type StaticRoute = {
  [K in keyof typeof ROUTES]: (typeof ROUTES)[K] extends string
    ? (typeof ROUTES)[K]
    : never;
}[keyof typeof ROUTES];
