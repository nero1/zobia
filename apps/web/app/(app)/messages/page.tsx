"use client";

/**
 * app/(app)/messages/page.tsx
 *
 * DM inbox page (web version).
 * Shows conversation list with search, unread badges, timestamps,
 * and a "New Message" dialog.
 */

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DMConversation {
  conversationId: string;
  participantUserId: string;
  participantUsername: string;
  participantAvatarEmoji: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface UserSearchResult {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ConversationSkeleton() {
  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-4">
          <div className="h-11 w-11 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-28 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-3 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
          <div className="h-3 w-10 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Message Dialog
// ---------------------------------------------------------------------------

interface NewMessageDialogProps {
  onClose: () => void;
  onOpen: (userId: string) => void;
}

function NewMessageDialog({ onClose, onOpen }: NewMessageDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`, { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { users: UserSearchResult[] };
        if (!cancelled) setResults(data.users ?? []);
      } catch { /* ignore */ }
      if (!cancelled) setSearching(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="New message"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">New Message</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Close dialog"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="px-4 py-3">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username…"
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
          />
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto">
          {searching && (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          )}
          {!searching && query.trim() && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-neutral-400">No users found for &quot;{query.trim()}&quot;</p>
          )}
          {results.map((u) => (
            <button
              key={u.userId}
              onClick={() => onOpen(u.userId)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
                {u.avatarEmoji}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{u.displayName}</p>
                <p className="text-xs text-neutral-400">@{u.username}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * DM inbox — conversation list with search and "New Message" dialog.
 */
export default function MessagesPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<DMConversation[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewMessage, setShowNewMessage] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/messages/dm", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (!res.ok) throw new Error("Failed to load messages");
        const data = (await res.json()) as { conversations?: DMConversation[] };
        setConversations(data.conversations ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!conversations) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      c.participantUsername.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  function handleOpenUser(userId: string) {
    // Navigate to DM conversation — use userId as conversationId until resolved
    setShowNewMessage(false);
    router.push(`/messages/${userId}`);
  }

  return (
    <>
      <div className="mx-auto w-full max-w-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between px-1">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Messages</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/messages/groups"
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              👥 Groups
            </Link>
            <button
              onClick={() => setShowNewMessage(true)}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              + New Message
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="mb-4 px-1">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations…"
              className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Conversation list */}
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          {conversations === undefined ? (
            <ConversationSkeleton />
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <span className="text-4xl">💬</span>
              <p className="mt-3 text-base font-semibold text-neutral-700 dark:text-neutral-300">
                {searchQuery.trim() ? "No conversations match your search" : "No messages yet"}
              </p>
              <p className="mt-1 text-sm text-neutral-400">
                {searchQuery.trim()
                  ? "Try a different name or keyword"
                  : "Start a conversation by clicking \"New Message\""}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filtered.map((c) => (
                <Link
                  key={c.conversationId}
                  href={`/messages/${c.conversationId}`}
                  className="flex items-center gap-3 px-4 py-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-2xl dark:bg-neutral-800">
                      {c.participantAvatarEmoji}
                    </div>
                    {c.unreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-xs font-bold text-white">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${c.unreadCount > 0 ? "font-bold text-neutral-900 dark:text-neutral-50" : "font-semibold text-neutral-700 dark:text-neutral-300"}`}>
                        @{c.participantUsername}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-400">{timeAgo(c.lastMessageAt)}</span>
                    </div>
                    <p className={`truncate text-sm ${c.unreadCount > 0 ? "font-medium text-neutral-700 dark:text-neutral-300" : "text-neutral-500"}`}>
                      {c.lastMessage || "No messages yet"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Message dialog */}
      {showNewMessage && (
        <NewMessageDialog
          onClose={() => setShowNewMessage(false)}
          onOpen={handleOpenUser}
        />
      )}
    </>
  );
}
