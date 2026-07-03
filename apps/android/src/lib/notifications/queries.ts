/**
 * apps/android/src/lib/notifications/queries.ts
 *
 * Shared TanStack Query definitions for /api/notifications so the
 * notifications list page and the TopBar unread-count badge read from the
 * same cache entry — one network call serves both, per the project's
 * "minimize Redis/backend load" constraint (no dedicated badge-polling).
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
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
