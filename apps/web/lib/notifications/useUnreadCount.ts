"use client";

/**
 * lib/notifications/useUnreadCount.ts
 *
 * Shared TanStack Query hook for the notifications bell badge. Reuses the
 * same GET /api/notifications response the notifications page already
 * fetches (which returns { notifications, unreadCount }) — no dedicated
 * polling endpoint, per the project's "minimize Redis/backend load" rule.
 */

import { useQuery } from "@tanstack/react-query";

interface NotificationsResponse {
  notifications: unknown[];
  unreadCount: number;
}

export const notificationsQueryKey = ["notifications", "unread-badge"] as const;

const NOTIFICATIONS_STALE_TIME = 2 * 60_000;

async function fetchUnreadCount(): Promise<number> {
  const res = await fetch("/api/notifications?limit=1", { credentials: "include" });
  if (!res.ok) return 0;
  const data = (await res.json()) as NotificationsResponse;
  return data?.unreadCount ?? 0;
}

export function useUnreadNotificationsCount(): number {
  const { data } = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: fetchUnreadCount,
    staleTime: NOTIFICATIONS_STALE_TIME,
  });
  return data ?? 0;
}
