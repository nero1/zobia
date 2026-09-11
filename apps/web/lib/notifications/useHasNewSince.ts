"use client";

/**
 * lib/notifications/useHasNewSince.ts
 *
 * Generic "new since last visit" red-dot signal for a nav menu item, shared
 * by Notifications (useHasNewNotifications.ts, kept as a thin wrapper for
 * its existing call sites), Inbox/Announcements, and Messages.
 *
 * The dot means "something newer has arrived since this device last opened
 * that page", regardless of read/unread state — visiting the page clears it
 * immediately (even without marking anything read), and it reappears only
 * once something newer arrives after that. Tracked per-device via
 * localStorage, scoped by user id (so a shared device never leaks one
 * account's "seen" state into another's) and by `kind` (so Inbox/Messages/
 * Notifications don't clobber each other's state). No extra Redis/DB calls
 * beyond whatever list request the page/badge already makes — this just
 * reads the single latest timestamp out of that same response.
 */

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth/hooks";

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
  /** Unique key namespacing this signal's localStorage entry and query cache (e.g. "messages", "announcements"). */
  kind: string;
  /** Fetch the most recent item's timestamp (ISO string), or null if there is none / the request failed. */
  fetchLatestCreatedAt: () => Promise<string | null>;
}

/** True when something newer has arrived since this device last visited the `kind` page. */
export function useHasNewSince({ kind, fetchLatestCreatedAt }: UseHasNewSinceOptions): boolean {
  const { user } = useAuth();
  const { data: latestCreatedAt } = useQuery({
    queryKey: ["has-new-since", kind, user?.id],
    queryFn: fetchLatestCreatedAt,
    staleTime: STALE_TIME,
    enabled: !!user?.id,
  });

  if (!user?.id || !latestCreatedAt) return false;
  const seenAt = readSeenAt(kind, user.id);
  if (!seenAt) return true; // never visited this page on this device yet
  return new Date(latestCreatedAt).getTime() > new Date(seenAt).getTime();
}

/** Mount on the `kind` page: marks everything up to "now" as seen. */
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
    queryClient.invalidateQueries({ queryKey: ["has-new-since", kind, user.id] });
  }, [kind, user?.id, queryClient]);
}

// ---------------------------------------------------------------------------
// Per-surface fetchers
// ---------------------------------------------------------------------------

interface AnnouncementsResponse {
  items?: { created_at?: string }[];
}

async function fetchLatestAnnouncementCreatedAt(): Promise<string | null> {
  const res = await fetch("/api/announcements?limit=1", { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json()) as AnnouncementsResponse;
  return data?.items?.[0]?.created_at ?? null;
}

/** True when a new Inbox/Announcement message has arrived since last visiting /announcements on this device. */
export function useHasNewAnnouncements(): boolean {
  return useHasNewSince({ kind: "announcements", fetchLatestCreatedAt: fetchLatestAnnouncementCreatedAt });
}

/** Mount on the /announcements page. */
export function useMarkAnnouncementsSeen(): void {
  useMarkSeenSince("announcements");
}

interface DmConversationsResponse {
  conversations?: { lastMessageAt?: string }[];
}

async function fetchLatestMessageAt(): Promise<string | null> {
  const res = await fetch("/api/messages/dm?limit=1", { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json()) as DmConversationsResponse;
  return data?.conversations?.[0]?.lastMessageAt ?? null;
}

/** True when a new DM has arrived since last visiting /messages on this device. */
export function useHasNewMessages(): boolean {
  return useHasNewSince({ kind: "messages", fetchLatestCreatedAt: fetchLatestMessageAt });
}

/** Mount on the /messages page. */
export function useMarkMessagesSeen(): void {
  useMarkSeenSince("messages");
}
