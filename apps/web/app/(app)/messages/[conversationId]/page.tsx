"use client";

/**
 * app/(app)/messages/[conversationId]/page.tsx
 *
 * DM conversation page (web version).
 * Shows message feed for a single direct-message conversation.
 * Polls for new messages every 5 seconds.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationInfo {
  conversationId: string;
  participantUserId: string;
  participantUsername: string;
  participantDisplayName: string;
  participantAvatarEmoji: string;
  dmCoinCost?: number | null;
}

interface ConnectionBadge {
  score: number;
  streakDays: number;
  badgeLevel: "bronze" | "silver" | "gold" | "platinum" | null;
  badgeLabel: string | null;
}

interface DMMessage {
  id: string;
  senderId: string;
  senderUsername: string;
  senderAvatarEmoji: string;
  content: string;
  createdAt: string;
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

function MessageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`flex animate-pulse gap-2.5 ${i % 2 === 0 ? "" : "flex-row-reverse"}`}>
          <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className={`space-y-1.5 ${i % 2 === 0 ? "" : "items-end flex flex-col"}`}>
            <div className="h-3 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-9 w-48 rounded-2xl bg-neutral-200 dark:bg-neutral-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  msg: DMMessage;
  isOwn: boolean;
}

function MessageBubble({ msg, isOwn }: MessageBubbleProps) {
  return (
    <div className={`flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""}`}>
      <span className="mt-1 h-8 w-8 shrink-0 rounded-full bg-neutral-100 text-center text-lg leading-8 dark:bg-neutral-800">
        {msg.senderAvatarEmoji}
      </span>
      <div className={`max-w-[75%] flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="flex items-baseline gap-1.5">
          {!isOwn && (
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              @{msg.senderUsername}
            </span>
          )}
          <span className="text-xs text-neutral-400">{timeAgo(msg.createdAt)}</span>
        </div>
        <div
          className={`mt-0.5 rounded-2xl px-3.5 py-2 text-sm ${
            isOwn
              ? "rounded-tr-sm bg-blue-600 text-white"
              : "rounded-tl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          }`}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * DM conversation — message feed with real-time polling.
 */
export default function DMConversationPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.conversationId as string;

  const [conversation, setConversation] = useState<ConversationInfo | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Connection Badge — PRD §5: Conversation Score unlocks exclusive DM badge
  const [connectionBadge, setConnectionBadge] = useState<ConnectionBadge | null>(null);

  const feedRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  // Fetch current user
  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { id: string }) => setCurrentUserId(d.id))
      .catch(() => {});
  }, []);

  // Fetch conversation info
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/messages/dm/${conversationId}`, { credentials: "include" });
        if (res.status === 401) { router.push("/login"); return; }
        if (!res.ok) throw new Error("Conversation not found");
        const data = (await res.json()) as { conversation: ConversationInfo };
        setConversation(data.conversation);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error loading conversation");
      } finally {
        setLoadingConversation(false);
      }
    })();
  }, [conversationId, router]);

  // Fetch connection badge (once on mount — refreshes after each message sent)
  const fetchConnectionBadge = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/dm/${conversationId}/connection-badge`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { badge?: ConnectionBadge; data?: ConnectionBadge };
      const badge = data.badge ?? data.data ?? null;
      if (badge) setConnectionBadge(badge);
    } catch { /* non-fatal */ }
  }, [conversationId]);

  useEffect(() => {
    void fetchConnectionBadge();
  }, [fetchConnectionBadge]);

  // Fetch messages + poll every 5 seconds
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/dm/${conversationId}/messages`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: DMMessage[] };
      setMessages(data.messages ?? []);
    } catch { /* ignore */ } finally {
      setLoadingMessages(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void fetchMessages();
    pollRef.current = setInterval(fetchMessages, 5000);
    return () => clearInterval(pollRef.current);
  }, [fetchMessages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/messages/dm/${conversationId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: input.trim() }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        throw new Error(d.message ?? "Failed to send");
      }
      setInput("");
      await fetchMessages();
      void fetchConnectionBadge();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
      setTimeout(() => setError(null), 3000);
    } finally {
      setSending(false);
    }
  }

  if (loadingConversation) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !conversation) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-neutral-500">{error}</p>
        <Link href="/messages" className="text-sm text-blue-600 hover:underline">
          Back to Messages
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <Link
          href="/messages"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label="Back to messages"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        {conversation && (
          <>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
              {conversation.participantAvatarEmoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-50">
                  {conversation.participantDisplayName || `@${conversation.participantUsername}`}
                </p>
                {/* Connection Badge — PRD §5: earned through sustained daily conversation streak */}
                {connectionBadge?.badgeLabel && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      connectionBadge.badgeLevel === "platinum"
                        ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200"
                        : connectionBadge.badgeLevel === "gold"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                        : connectionBadge.badgeLevel === "silver"
                        ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                        : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200"
                    }`}
                    title={`Connection score: ${connectionBadge.score} · ${connectionBadge.streakDays}-day streak`}
                  >
                    🔗 {connectionBadge.badgeLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400">
                @{conversation.participantUsername}
                {connectionBadge && connectionBadge.streakDays > 0 && (
                  <span className="ml-2 text-teal-500">{connectionBadge.streakDays}-day streak</span>
                )}
              </p>
            </div>
          </>
        )}
      </div>

      {/* DM coin cost notice */}
      {conversation?.dmCoinCost && conversation.dmCoinCost > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Sending a message costs <span className="font-semibold">{conversation.dmCoinCost} coins</span> per message.
          </p>
        </div>
      )}

      {/* Error toast */}
      {error && conversation && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-800 dark:bg-red-950">
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Message feed */}
      <div
        ref={feedRef}
        className="flex-1 space-y-4 overflow-y-auto p-4"
        aria-live="polite"
        aria-label="Direct messages"
      >
        {loadingMessages ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
            <span className="text-4xl">💬</span>
            <p className="mt-2 text-sm">No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isOwn={msg.senderId === currentUserId}
            />
          ))
        )}
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSend}
        className="flex gap-2 border-t border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          maxLength={1000}
          className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
