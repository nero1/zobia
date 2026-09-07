/**
 * apps/android/src/lib/notifications/queries.ts
 *
 * Shared TanStack Query definitions for /api/notifications so the
 * notifications list page and the TopBar unread-count badge read from the
 * same cache entry — one network call serves both, per the project's
 * "minimize Redis/backend load" constraint (no dedicated badge-polling).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
  // ZSB-16 fix: server-derived in-app route for this notification (see
  // apps/web/app/api/notifications/route.ts's deriveNotificationActionUrl),
  // mirrors web's `actionUrl` field. Still re-validated against the local
  // allowlist (lib/notifications/routing.ts) before navigating — never
  // trusted blindly.
  actionUrl?: string | null;
}

export interface NotificationsPayload {
  notifications: Notification[];
  unreadCount: number;
}

export const notificationsQueryKey = ['notifications'] as const;

async function fetchNotificationsPayload(): Promise<NotificationsPayload> {
  const { data } = await apiClient.get<NotificationsPayload>('/notifications');
  return { notifications: data?.notifications ?? [], unreadCount: data?.unreadCount ?? 0 };
}

/** Long staleTime — badge/list share this cache entry instead of polling. */
const NOTIFICATIONS_STALE_TIME = 2 * 60_000;

export function useNotificationsQuery() {
  return useQuery({
    queryKey: notificationsQueryKey,
    queryFn: fetchNotificationsPayload,
    staleTime: NOTIFICATIONS_STALE_TIME,
  });
}

export function useUnreadNotificationsCount(): number {
  const { data } = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: fetchNotificationsPayload,
    staleTime: NOTIFICATIONS_STALE_TIME,
  });
  return data?.unreadCount ?? 0;
}

// ---------------------------------------------------------------------------
// "New since last opened" dot — mirrors
// apps/web/lib/notifications/useHasNewNotifications.ts.
//
// A distinct signal from unread count: true when a notification has arrived
// since this device last opened the notifications screen, regardless of
// read/unread state. Reuses the same cached payload above — no extra
// network calls. Per-user via localStorage (Capacitor's WebView supports it
// like a browser) so a shared device never leaks one account's "seen" state
// into another's.
// ---------------------------------------------------------------------------

function seenAtStorageKey(userId: string): string {
  return `zobia_notifications_seen_at:${userId}`;
}

function readSeenAt(userId: string): string | null {
  try {
    return window.localStorage.getItem(seenAtStorageKey(userId));
  } catch {
    return null;
  }
}

export function useHasNewNotifications(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: fetchNotificationsPayload,
    staleTime: NOTIFICATIONS_STALE_TIME,
  });

  const latestCreatedAt = data?.notifications?.[0]?.createdAt;
  if (!user?.id || !latestCreatedAt) return false;
  const seenAt = readSeenAt(user.id);
  if (!seenAt) return true;
  return new Date(latestCreatedAt).getTime() > new Date(seenAt).getTime();
}

/** Call once when the notifications screen mounts to mark everything as seen. */
export function useMarkNotificationsSeen(): void {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user?.id) return;
    try {
      window.localStorage.setItem(seenAtStorageKey(user.id), new Date().toISOString());
    } catch {
      // localStorage unavailable — the dot just won't clear on this device.
    }
    queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
  }, [user?.id, queryClient]);
}
