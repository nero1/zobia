/**
 * apps/android/src/lib/notifications/useHasNewSince.ts
 *
 * Generic "new since last visit" red-dot signal for a nav menu item —
 * mirrors apps/web/lib/notifications/useHasNewSince.ts so the Capacitor app
 * matches mobile web/PWA behavior. Used for Inbox (Announcements) and
 * Messages, alongside the existing Notifications signal in
 * lib/notifications/queries.ts.
 *
 * Per-device via localStorage (Capacitor's WebView supports it like a
 * browser), scoped by user id and by `kind` so Inbox/Messages/Notifications
 * don't clobber each other's state. No extra network calls beyond whatever
 * list request the page already makes.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

const STALE_TIME = 2 * 60_000;

function seenAtStorageKey(kind: string, userId: string): string {
  return `zobia_${kind}_seen_at:${userId}`;
}

function readSeenAt(kind: string, userId: string): string | null {
  try {
    return window.localStorage.getItem(seenAtStorageKey(kind, userId));
  } catch {
    return null;
  }
}

export interface UseHasNewSinceOptions {
  kind: string;
  fetchLatestCreatedAt: () => Promise<string | null>;
}

export function useHasNewSince({ kind, fetchLatestCreatedAt }: UseHasNewSinceOptions): boolean {
  const { user } = useAuth();
  const { data: latestCreatedAt } = useQuery({
    queryKey: ['has-new-since', kind, user?.id],
    queryFn: fetchLatestCreatedAt,
    staleTime: STALE_TIME,
    enabled: !!user?.id,
  });

  if (!user?.id || !latestCreatedAt) return false;
  const seenAt = readSeenAt(kind, user.id);
  if (!seenAt) return true;
  return new Date(latestCreatedAt).getTime() > new Date(seenAt).getTime();
}

export function useMarkSeenSince(kind: string): void {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!user?.id) return;
    try {
      window.localStorage.setItem(seenAtStorageKey(kind, user.id), new Date().toISOString());
    } catch {
      // localStorage unavailable — the dot just won't clear on this device.
    }
    queryClient.invalidateQueries({ queryKey: ['has-new-since', kind, user.id] });
  }, [kind, user?.id, queryClient]);
}

// ---------------------------------------------------------------------------
// Per-surface fetchers
// ---------------------------------------------------------------------------

async function fetchLatestAnnouncementCreatedAt(): Promise<string | null> {
  const { data } = await apiClient.get<{ items?: { created_at?: string }[] }>('/announcements?limit=1');
  return data?.items?.[0]?.created_at ?? null;
}

/** True when a new Inbox/Announcement message has arrived since last visiting /announcements on this device. */
export function useHasNewAnnouncements(): boolean {
  return useHasNewSince({ kind: 'announcements', fetchLatestCreatedAt: fetchLatestAnnouncementCreatedAt });
}

/** Mount on the /announcements screen. */
export function useMarkAnnouncementsSeen(): void {
  useMarkSeenSince('announcements');
}

async function fetchLatestMessageAt(): Promise<string | null> {
  const { data } = await apiClient.get<{ conversations?: { lastMessageAt?: string }[] }>('/messages/dm?limit=1');
  return data?.conversations?.[0]?.lastMessageAt ?? null;
}

/** True when a new DM has arrived since last visiting /messages on this device. */
export function useHasNewMessages(): boolean {
  return useHasNewSince({ kind: 'messages', fetchLatestCreatedAt: fetchLatestMessageAt });
}

/** Mount on the /messages screen. */
export function useMarkMessagesSeen(): void {
  useMarkSeenSince('messages');
}
