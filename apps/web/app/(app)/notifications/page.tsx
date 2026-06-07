"use client";

/**
 * app/(app)/notifications/page.tsx
 *
 * Notifications page.
 * - Fetches from /api/notifications (GET)
 * - Lists notifications with icon, title, body, timestamp, read/unread state
 * - "Mark all read" button (POST /api/notifications/read-all)
 * - Notification type icons
 * - Infinite scroll / load more
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationType =
  | "guild_war"
  | "guild_low_contribution"
  | "nemesis"
  | "quest"
  | "gift"
  | "rank_up"
  | "friend_request"
  | "mention"
  | "announcement"
  | "season"
  | "prestige_complete"
  | "mystery_xp_drop"
  | "leaderboard_ripple"
  | "platform_council_invite"
  | "reengagement"
  | "streak_risk"
  | "system"
  | string;

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  actionUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function notificationIcon(type: NotificationType): string {
  const map: Record<string, string> = {
    guild_war: "⚔️",
    guild_low_contribution: "📉",
    nemesis: "🎯",
    quest: "📋",
    gift: "🎁",
    rank_up: "🏅",
    friend_request: "👋",
    prestige_complete: "🔥",
    mystery_xp_drop: "✨",
    leaderboard_ripple: "📊",
    platform_council_invite: "🏛️",
    reengagement: "👋",
    streak_risk: "⚠️",
    mention: "💬",
    announcement: "📢",
    season: "🌟",
    system: "🔔",
  };
  return map[type] ?? "🔔";
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Payload → human-readable title + body
// ---------------------------------------------------------------------------

interface RawNotification {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
  // May be pre-formatted by the API or derived below
  title?: string;
  body?: string;
}

function formatNotification(n: RawNotification): Notification {
  // If API already provides title/body, use them
  if (n.title) return n as Notification;
  const p = n.payload ?? {};
  const str = (key: string, fallback = "") => String(p[key] ?? fallback);
  const num = (key: string, fallback = 0) => Number(p[key] ?? fallback);

  let title = "Notification";
  let body = "";

  switch (n.type) {
    case "guild_war":
      title = "⚔️ Guild War Update";
      body = str("message", "Your guild has a war update.");
      break;
    case "guild_low_contribution":
      title = "📉 Low Contribution Alert";
      body = `Your contribution score (${num("contributionScore")}) is below your guild's average (${num("guildAverage")}). Step it up!`;
      break;
    case "nemesis":
      title = "🎯 Nemesis Update";
      body = str("message", "Your nemesis has made a move.");
      break;
    case "quest":
      title = "📋 Quest Update";
      body = str("message", "You have a quest update.");
      break;
    case "gift":
      title = "🎁 You received a gift!";
      body = str("message", "Someone sent you a gift.");
      break;
    case "rank_up":
      title = `🏅 Rank Up! You're now ${str("newRank", "a higher rank")}`;
      body = str("message", "");
      break;
    case "friend_request":
      title = "👋 New Friend Request";
      body = `${str("senderUsername", "Someone")} wants to connect.`;
      break;
    case "mention":
      title = "💬 You were mentioned";
      body = str("message", "You were mentioned in a conversation.");
      break;
    case "announcement":
      title = str("subject", "📢 Platform Announcement");
      body = str("body", "");
      break;
    case "season":
      title = "🌟 Season Update";
      body = str("message", "There's a season update.");
      break;
    case "prestige_complete":
      title = `🔥 Prestige ${num("prestigeCount")} Achieved!`;
      body = str("title", "You have been reborn.");
      break;
    case "mystery_xp_drop":
      title = "✨ Mystery XP Drop!";
      body = `You earned ${num("xpAmount").toLocaleString()} bonus XP from a mystery drop.`;
      break;
    case "leaderboard_ripple":
      title = "📊 Leaderboard Change";
      body = str("message", "Your leaderboard rank has changed.");
      break;
    case "platform_council_invite":
      title = "🏛️ Platform Council Invitation";
      body = "You've been invited to join the Platform Council based on your Legacy Score.";
      break;
    case "reengagement":
      title = "👋 Welcome back!";
      body = str("message", "Things have happened while you were away.");
      break;
    case "streak_risk":
      title = "⚠️ Streak at Risk";
      body = `You have a ${num("streakDays")}-day streak. Log in today to keep it alive!`;
      break;
    default:
      title = str("subject", str("title", n.type.replace(/_/g, " ")));
      body = str("body", str("message", ""));
  }

  return { ...n, title, body };
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function NotificationSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex animate-pulse gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="h-10 w-10 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
          <div className="h-3 w-12 shrink-0 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification item
// ---------------------------------------------------------------------------

function NotificationItem({ notification }: { notification: Notification }) {
  const unread = !notification.readAt;

  return (
    <div
      className={`flex gap-3 rounded-xl border bg-white p-4 transition-colors dark:bg-neutral-900 ${
        unread
          ? "border-blue-300 dark:border-blue-700"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
        {notificationIcon(notification.type)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-sm font-semibold leading-snug ${
              unread ? "text-neutral-900 dark:text-neutral-50" : "text-neutral-700 dark:text-neutral-300"
            }`}
          >
            {unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue-500 align-middle" />}
            {notification.title}
          </p>
          <span className="shrink-0 text-xs text-neutral-400">{relativeTime(notification.createdAt)}</span>
        </div>
        {notification.body && (
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{notification.body}</p>
        )}
        {notification.actionUrl && (
          <a
            href={notification.actionUrl}
            className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
          >
            View →
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async (after?: string) => {
    const url = `/api/notifications?limit=${PAGE_SIZE}${after ? `&after=${after}` : ""}`;
    const res = await fetch(url, { credentials: "include" });
    if (res.status === 401) { window.location.href = "/login"; return null; }
    if (!res.ok) throw new Error("Failed to load notifications");
    const data = (await res.json()) as
      | RawNotification[]
      | { notifications?: RawNotification[]; nextCursor?: string; hasMore?: boolean };

    const rawList: RawNotification[] = Array.isArray(data)
      ? data
      : (data as { notifications?: RawNotification[] }).notifications ?? [];
    const list: Notification[] = rawList.map(formatNotification);
    const next: string | undefined = (data as { nextCursor?: string }).nextCursor;
    const more: boolean =
      (data as { hasMore?: boolean }).hasMore ??
      list.length >= PAGE_SIZE;

    return { list, next, more };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const result = await fetchNotifications();
        if (!result) return;
        setNotifications(result.list);
        setCursor(result.next);
        setHasMore(result.more);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchNotifications]);

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchNotifications(cursor);
      if (!result) return;
      setNotifications((prev) => [...prev, ...result.list]);
      setCursor(result.next);
      setHasMore(result.more);
    } catch {
      // Ignore load-more errors
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      await fetch("/api/notifications/read-all", { method: "POST", credentials: "include" });
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
      );
    } catch {
      // Ignore
    } finally {
      setMarkingAll(false);
    }
  }

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <h1 className="mb-5 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Notifications</h1>
        <NotificationSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Notifications</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              {unreadCount} unread
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="rounded-xl border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {markingAll ? "Marking…" : "Mark all read"}
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">🔔</span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">All caught up!</h2>
          <p className="mt-1 text-sm text-neutral-500">No notifications yet. Check back soon.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="rounded-xl border border-neutral-300 px-5 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
