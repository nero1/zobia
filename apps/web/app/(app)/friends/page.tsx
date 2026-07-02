"use client";

/**
 * app/(app)/friends/page.tsx
 *
 * Dedicated friends management page with four tabs:
 *   - My Friends — paginated list of accepted friends
 *   - Requests   — Received (accept/decline) and Sent (withdraw) sub-tabs
 *   - Recent     — people the user has recently chatted with
 *   - Discover   — friend suggestions (friends-of-friends, guild mates)
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/Avatar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Friend {
  id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  rank_name: string | null;
  is_creator?: boolean;
  is_verified?: boolean;
  plan?: string | null;
}

interface FriendRequest {
  id: string;
  requester_id?: string;
  addressee_id?: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  rank_name?: string | null;
  created_at: string;
}

interface Suggestion {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  rankName: string | null;
  isVerified: boolean;
  mutualFriendCount: number;
}

interface RecentChat {
  conversationId: string;
  participantUserId: string;
  participantUsername: string;
  participantDisplayName: string | null;
  participantAvatarEmoji: string | null;
  lastMessageAt: string;
}

type Tab = "friends" | "requests" | "recent" | "discover";
type RequestsSubTab = "received" | "sent";

// ---------------------------------------------------------------------------
// Profile link wrapper — avatar + name, clickable to /profile/:userId
// ---------------------------------------------------------------------------

function ProfileLink({
  userId,
  name,
  username,
  emoji,
  children,
}: {
  userId: string;
  name: string;
  username: string;
  emoji: string | null;
  children?: React.ReactNode;
}) {
  return (
    <Link href={`/profile/${userId}`} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80">
      <Avatar name={name} emoji={emoji ?? undefined} size="sm" rankTier="none" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {name}
        </p>
        <p className="text-xs text-neutral-500">@{username}</p>
      </div>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// My Friends Tab
// ---------------------------------------------------------------------------

function FriendsTab() {
  const { t } = useTranslation();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/friends", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setFriends(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const removeFriend = useCallback(async (friendId: string) => {
    setRemoving(friendId);
    try {
      await fetch(`/api/friends/${friendId}`, { method: "DELETE", credentials: "include" });
      setFriends((prev) => prev.filter((f) => f.id !== friendId));
    } catch { /* non-fatal */ }
    finally { setRemoving(null); }
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>;
  if (friends.length === 0)
    return (
      <div className="py-12 text-center">
        <p className="text-neutral-500 dark:text-neutral-400">{t("friends.empty.noFriends")}</p>
        <p className="mt-1 text-sm text-neutral-400 dark:text-neutral-500">
          Go to the Discover tab to find people you might know.
        </p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {friends.map((f) => (
        <li key={f.id} className="flex items-center gap-3 py-3">
          <ProfileLink
            userId={f.id}
            name={f.display_name ?? f.username}
            username={f.username}
            emoji={f.avatar_emoji}
          />
          <button
            onClick={() => removeFriend(f.id)}
            disabled={removing === f.id}
            className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400"
          >
            {t("friends.removeFriend")}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Received Requests sub-tab
// ---------------------------------------------------------------------------

function ReceivedRequestsTab() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/friends/requests", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRequests(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const respond = useCallback(async (requestId: string, action: "accept" | "reject") => {
    setActioning(requestId);
    try {
      await fetch(`/api/friends/${requestId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch { /* non-fatal */ }
    finally { setActioning(null); }
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>;
  if (requests.length === 0)
    return (
      <div className="py-10 text-center">
        <p className="text-neutral-500 dark:text-neutral-400">{t("friends.empty.noReceivedRequests")}</p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {requests.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3">
          <ProfileLink
            userId={r.requester_id ?? r.id}
            name={r.display_name ?? r.username}
            username={r.username}
            emoji={r.avatar_emoji}
          />
          <div className="flex gap-2">
            <button
              onClick={() => respond(r.id, "accept")}
              disabled={actioning === r.id}
              className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t("friends.accept")}
            </button>
            <button
              onClick={() => respond(r.id, "reject")}
              disabled={actioning === r.id}
              className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400"
            >
              {t("friends.decline")}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Sent Requests sub-tab
// ---------------------------------------------------------------------------

function SentRequestsTab() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/friends/requests/sent", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRequests(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const withdraw = useCallback(async (requestId: string) => {
    setWithdrawing(requestId);
    try {
      await fetch(`/api/friends/${requestId}`, { method: "DELETE", credentials: "include" });
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch { /* non-fatal */ }
    finally { setWithdrawing(null); }
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>;
  if (requests.length === 0)
    return (
      <div className="py-10 text-center">
        <p className="text-neutral-500 dark:text-neutral-400">{t("friends.empty.noSentRequests")}</p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {requests.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3">
          <ProfileLink
            userId={r.addressee_id ?? r.id}
            name={r.display_name ?? r.username}
            username={r.username}
            emoji={r.avatar_emoji}
          />
          <button
            onClick={() => withdraw(r.id)}
            disabled={withdrawing === r.id}
            className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400"
          >
            {withdrawing === r.id ? t("friends.requests.withdrawing") : t("friends.requests.withdraw")}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Requests Tab (outer) — wraps Received + Sent sub-tabs
// ---------------------------------------------------------------------------

function RequestsTab({ onSeen }: { onSeen: () => void }) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<RequestsSubTab>("received");
  const [receivedCount, setReceivedCount] = useState<number | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/friends/requests", { credentials: "include" }).then((r) => r.json()).catch(() => null),
      fetch("/api/friends/requests/sent", { credentials: "include" }).then((r) => r.json()).catch(() => null),
    ]).then(([recv, sent]) => {
      setReceivedCount((recv?.data ?? []).length);
      setSentCount((sent?.data ?? []).length);
    });
  }, []);

  // Mark incoming friend-request notifications read as soon as this tab is
  // opened, and clear the blue dot on the parent tab bar.
  useEffect(() => {
    onSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subTabs: { id: RequestsSubTab; label: string; count: number | null }[] = [
    { id: "received", label: t("friends.requests.received"), count: receivedCount },
    { id: "sent",     label: t("friends.requests.sent"),     count: sentCount },
  ];

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="mb-4 flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-950">
        {subTabs.map((st) => (
          <button
            key={st.id}
            onClick={() => setSubTab(st.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all ${
              subTab === st.id
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {st.label}
            {st.count !== null && st.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                subTab === st.id
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
              }`}>
                {st.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {subTab === "received" && <ReceivedRequestsTab />}
      {subTab === "sent" && <SentRequestsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Chats Tab
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function RecentChatsTab() {
  const { t } = useTranslation();
  const [chats, setChats] = useState<RecentChat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/messages/dm?limit=20", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setChats(d?.conversations ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>;
  if (chats.length === 0)
    return (
      <div className="py-12 text-center">
        <p className="text-neutral-500 dark:text-neutral-400">{t("friends.recent.empty", "No recent chats yet.")}</p>
        <p className="mt-1 text-sm text-neutral-400">
          {t("friends.recent.emptyHint", "People you message will show up here.")}
        </p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {chats.map((c) => (
        <li key={c.conversationId} className="flex items-center gap-3 py-3">
          <ProfileLink
            userId={c.participantUserId}
            name={c.participantDisplayName ?? c.participantUsername}
            username={c.participantUsername}
            emoji={c.participantAvatarEmoji}
          >
            <span className="ml-2 shrink-0 text-[10px] text-neutral-400">{relativeTime(c.lastMessageAt)}</span>
          </ProfileLink>
          <Link
            href={`/messages/${c.conversationId}`}
            className="shrink-0 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400"
          >
            💬 {t("friends.recent.message", "Message")}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Discover Tab
// ---------------------------------------------------------------------------

function DiscoverTab() {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/friends/suggestions", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setSuggestions(d.suggestions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sendRequest = useCallback(async (userId: string) => {
    setSending(userId);
    try {
      await fetch("/api/friends", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      setSent((prev) => new Set(prev).add(userId));
    } catch { /* non-fatal */ }
    finally { setSending(null); }
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-neutral-400">Loading…</div>;
  if (suggestions.length === 0)
    return (
      <div className="py-12 text-center">
        <p className="text-neutral-500 dark:text-neutral-400">{t("friends.empty.noSuggestions")}</p>
        <p className="mt-1 text-sm text-neutral-400">Check back later as you join more rooms and guilds.</p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {suggestions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 py-3">
          <ProfileLink
            userId={s.id}
            name={s.displayName}
            username={s.username}
            emoji={s.avatarEmoji}
          >
            {s.mutualFriendCount > 0 && (
              <span className="ml-2 shrink-0 text-xs text-neutral-400">
                · {s.mutualFriendCount} {s.mutualFriendCount === 1 ? t("friends.mutualFriend") : t("friends.mutualFriends")}
              </span>
            )}
          </ProfileLink>
          <button
            onClick={() => sendRequest(s.id)}
            disabled={sent.has(s.id) || sending === s.id}
            className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sent.has(s.id) ? t("friends.sent") : sending === s.id ? "Sending…" : t("friends.addFriend")}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FriendsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("friends");
  const [hasNewRequest, setHasNewRequest] = useState(false);

  // Check for unseen incoming friend requests on mount, to light up the
  // blue dot on the Requests tab.
  useEffect(() => {
    fetch("/api/notifications?type=friend_request&unread=true&limit=1", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHasNewRequest((d?.notifications ?? []).length > 0))
      .catch(() => {});
  }, []);

  const markRequestsSeen = useCallback(() => {
    setHasNewRequest(false);
    fetch("/api/notifications/read-all", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "friend_request" }),
    }).catch(() => {});
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "friends",  label: t("friends.tabs.myFriends") },
    { id: "requests", label: t("friends.tabs.requests") },
    { id: "recent",   label: t("friends.tabs.recent", "Recent") },
    { id: "discover", label: t("friends.tabs.discover") },
  ];

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("friends.title")}</h1>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        {tabs.map((tItem) => (
          <button
            key={tItem.id}
            onClick={() => setTab(tItem.id)}
            className={`relative flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              tab === tItem.id
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {tItem.id === "recent" ? "🕐 " : ""}
            {tItem.label}
            {tItem.id === "requests" && hasNewRequest && (
              <span
                className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-blue-600"
                aria-label={t("friends.newRequestBadge", "New friend request")}
                role="status"
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {tab === "friends" && <FriendsTab />}
        {tab === "requests" && <RequestsTab onSeen={markRequestsSeen} />}
        {tab === "recent" && <RecentChatsTab />}
        {tab === "discover" && <DiscoverTab />}
      </div>
    </div>
  );
}
