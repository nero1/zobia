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
} as const;

export const PUBLIC_PATHS = {
  profile: (username: string) => `/u/${encodeURIComponent(username)}`,
  room: (slug: string) => `/r/${encodeURIComponent(slug)}`,
  course: (slug: string) => `/c/${encodeURIComponent(slug)}`,
  game: (slug: string) => `/g/${encodeURIComponent(slug)}`,
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
