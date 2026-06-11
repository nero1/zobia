"use client";

/**
 * app/(app)/friends/page.tsx
 *
 * Dedicated friends management page with three tabs:
 *   - My Friends  — paginated list of accepted friends
 *   - Requests    — Received (accept/decline) and Sent (withdraw) sub-tabs
 *   - Discover    — friend suggestions (friends-of-friends, guild mates)
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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

type Tab = "friends" | "requests" | "discover";
type RequestsSubTab = "received" | "sent";

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function EmojiAvatar({ emoji, size = 10 }: { emoji: string; size?: number }) {
  return (
    <div
      className={`flex h-${size} w-${size} shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800`}
    >
      {emoji || "😊"}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Friends Tab
// ---------------------------------------------------------------------------

function FriendsTab() {
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
        <p className="text-neutral-500 dark:text-neutral-400">You haven&apos;t added any friends yet.</p>
        <p className="mt-1 text-sm text-neutral-400 dark:text-neutral-500">
          Go to the Discover tab to find people you might know.
        </p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {friends.map((f) => (
        <li key={f.id} className="flex items-center gap-3 py-3">
          <EmojiAvatar emoji={f.avatar_emoji} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {f.display_name ?? f.username}
            </p>
            <p className="text-xs text-neutral-500">@{f.username}</p>
          </div>
          <button
            onClick={() => removeFriend(f.id)}
            disabled={removing === f.id}
            className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400"
          >
            {removing === f.id ? "Removing…" : "Remove"}
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
        <p className="text-neutral-500 dark:text-neutral-400">No pending requests.</p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {requests.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3">
          <EmojiAvatar emoji={r.avatar_emoji} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {r.display_name ?? r.username}
            </p>
            <p className="text-xs text-neutral-500">@{r.username}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => respond(r.id, "accept")}
              disabled={actioning === r.id}
              className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => respond(r.id, "reject")}
              disabled={actioning === r.id}
              className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400"
            >
              Decline
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
        <p className="text-neutral-500 dark:text-neutral-400">No pending sent requests.</p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {requests.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3">
          <EmojiAvatar emoji={r.avatar_emoji} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {r.display_name ?? r.username}
            </p>
            <p className="text-xs text-neutral-500">@{r.username}</p>
          </div>
          <button
            onClick={() => withdraw(r.id)}
            disabled={withdrawing === r.id}
            className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400"
          >
            {withdrawing === r.id ? "Withdrawing…" : "Withdraw"}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Requests Tab (outer) — wraps Received + Sent sub-tabs
// ---------------------------------------------------------------------------

function RequestsTab() {
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

  const subTabs: { id: RequestsSubTab; label: string; count: number | null }[] = [
    { id: "received", label: "Received", count: receivedCount },
    { id: "sent",     label: "Sent",     count: sentCount },
  ];

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="mb-4 flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-950">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-all ${
              subTab === t.id
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                subTab === t.id
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
              }`}>
                {t.count}
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
// Discover Tab
// ---------------------------------------------------------------------------

function DiscoverTab() {
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
        <p className="text-neutral-500 dark:text-neutral-400">No suggestions right now.</p>
        <p className="mt-1 text-sm text-neutral-400">Check back later as you join more rooms and guilds.</p>
      </div>
    );

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {suggestions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 py-3">
          <EmojiAvatar emoji={s.avatarEmoji} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {s.displayName}
            </p>
            <p className="text-xs text-neutral-500">
              @{s.username}
              {s.mutualFriendCount > 0 && (
                <span className="ml-2 text-neutral-400">· {s.mutualFriendCount} mutual {s.mutualFriendCount === 1 ? "friend" : "friends"}</span>
              )}
            </p>
          </div>
          <button
            onClick={() => sendRequest(s.id)}
            disabled={sent.has(s.id) || sending === s.id}
            className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sent.has(s.id) ? "Sent ✓" : sending === s.id ? "Sending…" : "Add"}
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
  const [tab, setTab] = useState<Tab>("friends");

  const tabs: { id: Tab; label: string }[] = [
    { id: "friends",  label: "My Friends" },
    { id: "requests", label: "Requests" },
    { id: "discover", label: "Discover" },
  ];

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Friends</h1>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              tab === t.id
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {tab === "friends" && <FriendsTab />}
        {tab === "requests" && <RequestsTab />}
        {tab === "discover" && <DiscoverTab />}
      </div>
    </div>
  );
}
