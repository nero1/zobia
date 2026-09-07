"use client";

/**
 * lib/notifications/useHasNewNotifications.ts
 *
 * Drives the small red "new notifications" dot on the bell icon and the
 * "Notifications" nav menu item.
 *
 * This is deliberately a different signal than unread count
 * (useUnreadCount.ts): the dot means "a notification has arrived since the
 * notifications page was last opened on this device", regardless of
 * read/unread state. Opening the notifications page clears it immediately
 * (see useMarkNotificationsSeen); it reappears only once a newer
 * notification arrives after that point. Per-device via localStorage
 * (scoped by user id so a shared device never leaks one account's "seen"
 * state into another's), avoiding any extra Redis/DB calls beyond the
 * GET /api/notifications request the bell badge already makes.
 */

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth/hooks";

interface NotificationsResponse {
  notifications?: { createdAt?: string }[];
}

export const latestNotificationQueryKey = ["notifications", "latest-created-at"] as const;

const STALE_TIME = 2 * 60_000;

function seenAtStorageKey(userId: string): string {
  return `zobia_notifications_seen_at:${userId}`;
}

async function fetchLatestNotificationCreatedAt(): Promise<string | null> {
  const res = await fetch("/api/notifications?limit=1", { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json()) as NotificationsResponse;
  return data?.notifications?.[0]?.createdAt ?? null;
}

function readSeenAt(userId: string): string | null {
  try {
    return window.localStorage.getItem(seenAtStorageKey(userId));
  } catch {
    return null;
  }
}

/** True when a notification has arrived since this device last loaded the notifications page. */
export function useHasNewNotifications(): boolean {
  const { user } = useAuth();
  const { data: latestCreatedAt } = useQuery({
    queryKey: latestNotificationQueryKey,
    queryFn: fetchLatestNotificationCreatedAt,
    staleTime: STALE_TIME,
    enabled: !!user?.id,
  });

  if (!user?.id || !latestCreatedAt) return false;
  const seenAt = readSeenAt(user.id);
  if (!seenAt) return true; // never opened notifications on this device yet
  return new Date(latestCreatedAt).getTime() > new Date(seenAt).getTime();
}

function markSeenNow(userId: string, queryClient: QueryClient): void {
  try {
    window.localStorage.setItem(seenAtStorageKey(userId), new Date().toISOString());
  } catch {
    // localStorage unavailable — the dot just won't clear on this device.
  }
  queryClient.invalidateQueries({ queryKey: latestNotificationQueryKey });
}

/** Mount on the notifications page: marks everything up to "now" as seen. */
export function useMarkNotificationsSeen(): void {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user?.id) return;
    markSeenNow(user.id, queryClient);
  }, [user?.id, queryClient]);
}
