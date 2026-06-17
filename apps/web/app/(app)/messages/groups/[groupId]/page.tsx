"use client";

/**
 * app/(app)/messages/groups/[groupId]/page.tsx
 *
 * Group conversation page (PRD §5).
 * Full chat interface with sender names/avatars, polling via setInterval (3s),
 * send text messages, no coin cost for group messages.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import { useAdaptiveChatPoll } from "@/lib/hooks/useAdaptiveChatPoll";
import { readCachedMessages, writeCachedMessages } from "@/lib/chat/messageCache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupInfo {
  id: string;
  name: string;
  avatar_emoji: string;
  tag: string | null;
  member_count: number;
  max_members: number;
  user_role: string;
}

interface GroupMessage {
  id: string;
  sender_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  message_type: string;
  content: string;
  created_at: string;
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
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function MessageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex animate-pulse gap-2.5">
          <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="space-y-1.5">
            <div className="h-3 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-9 w-52 rounded-2xl bg-neutral-200 dark:bg-neutral-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ msg, isOwn }: { msg: GroupMessage; isOwn: boolean }) {
  const isSticker = msg.message_type === "sticker";
  const isGif = msg.message_type === "gif";

  return (
    <div className={`flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""}`}>
      <span className="mt-1 h-8 w-8 shrink-0 rounded-full bg-neutral-100 text-center text-lg leading-8 dark:bg-neutral-800">
        {msg.avatar_emoji}
      </span>
      <div className={`flex min-w-0 max-w-[75%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="flex items-baseline gap-1.5">
          {!isOwn && (
            <span className="max-w-[40vw] truncate text-xs font-semibold text-blue-600 dark:text-blue-400">
              {msg.display_name || `@${msg.username}`}
            </span>
          )}
          <span className="shrink-0 text-xs text-neutral-400">{timeAgo(msg.created_at)}</span>
        </div>

        {isGif ? (
          <div className="mt-0.5 overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={msg.content} alt="GIF" className="max-h-48 max-w-[70vw] rounded-2xl object-cover sm:max-w-xs" loading="lazy" />
          </div>
        ) : isSticker ? (
          <div className="mt-0.5 flex items-center justify-center rounded-2xl bg-neutral-50 p-4 text-5xl dark:bg-neutral-800/50">
            {msg.content}
          </div>
        ) : (
          <div
            className={`mt-0.5 overflow-hidden whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
              isOwn
                ? "rounded-tr-sm bg-blue-600 text-white"
                : "rounded-tl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            }`}
          >
            {msg.content}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GroupConversationPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;
  const { t } = useTranslation();

  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>(
    () => readCachedMessages<GroupMessage>(`group:${groupId}`) ?? []
  );
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(
    () => (readCachedMessages<GroupMessage>(`group:${groupId}`)?.length ?? 0) === 0
  );
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  // Persist latest messages for instant first paint on reopen.
  useEffect(() => {
    if (messages.length) writeCachedMessages(`group:${groupId}`, messages);
  }, [messages, groupId]);

  // Fetch current user ID
  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { id: string }) => setCurrentUserId(d.id))
      .catch(() => {});
  }, []);

  // Fetch group info once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/messages/group`, { credentials: "include" });
        if (res.status === 401) { router.push("/auth/login"); return; }
        if (!res.ok) throw new Error("Group not found");
        const data = (await res.json()) as { items?: GroupInfo[] };
        const found = (data.items ?? []).find((g) => g.id === groupId);
        if (found) setGroup(found);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error loading group");
      } finally {
        setLoadingGroup(false);
      }
    })();
  }, [groupId, router]);

  // Newest message timestamp seen — drives delta polling (?after=).
  const latestCreatedAtRef = useRef<string | undefined>(undefined);

  // Merge incoming messages into state, deduping by id and keeping chronological
  // order. Shared by the initial load, the delta poll, and the realtime push.
  const mergeIncoming = useCallback((incoming: GroupMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = prev.slice();
      for (const m of incoming) {
        if (m && m.id && !seen.has(m.id)) { merged.push(m); seen.add(m.id); }
      }
      merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      latestCreatedAtRef.current = merged[merged.length - 1]?.created_at;
      return merged;
    });
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      // Delta fetch after the first load — only messages newer than the latest.
      const after = latestCreatedAtRef.current;
      const url = after
        ? `/api/messages/group/${groupId}?after=${encodeURIComponent(after)}`
        : `/api/messages/group/${groupId}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { data?: GroupMessage[] };
      mergeIncoming(data.data ?? []);
    } catch { /* ignore */ } finally {
      setLoadingMessages(false);
    }
  }, [groupId, mergeIncoming]);

  // Real-time push — delivers new messages instantly via configured realtime provider
  const realtimeConnected = useRealtimeChannel(
    groupId ? `group:${groupId}:messages` : null,
    useCallback((event: string, data: unknown) => {
      if (event === "new_message") {
        const msg = (data as { message?: GroupMessage }).message;
        if (msg) mergeIncoming([msg]);
      }
    }, [mergeIncoming])
  );

  // Baseline poll — fast (3s) when realtime is down / unconfigured, slow
  // reconcile (30s) when the socket is connected, paused while the tab is
  // hidden. Keeps serverless usage low while guaranteeing delivery.
  useAdaptiveChatPoll({
    poll: fetchMessages,
    connected: realtimeConnected,
    enabled: !!groupId,
  });

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    const optimisticId = `opt_${Date.now()}_${Math.random()}`;
    const optimisticMsg: GroupMessage = {
      id: optimisticId,
      sender_id: currentUserId ?? "me",
      username: "you",
      display_name: "You",
      avatar_emoji: "💬",
      message_type: "text",
      content: input.trim(),
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setInput("");
    try {
      const res = await fetch(`/api/messages/group/${groupId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: optimisticMsg.content, messageType: "text" }),
      });
      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        const d = (await res.json()) as { message?: string; error?: { code?: string; message?: string } };
        const code = d.error?.code ?? null;
        const message = d.error?.message ?? d.message ?? "Failed to send";
        const err = new Error(message) as Error & { code?: string | null };
        err.code = code;
        throw err;
      }
      const responseData = (await res.json()) as { data?: GroupMessage; message?: GroupMessage };
      const realMsg = responseData.data ?? responseData.message;
      if (realMsg) {
        setMessages((prev) => prev.map((m) => (m.id === optimisticId ? realMsg : m)));
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        await fetchMessages();
      }
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Failed to send") : "Failed to send");
      setTimeout(() => setError(null), 3000);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  if (loadingGroup) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !group) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-neutral-500">{error}</p>
        <Link href="/messages/groups" className="text-sm text-blue-600 hover:underline">Back to Groups</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <Link
          href="/messages/groups"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label="Back to groups"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        {group ? (
          <>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
              {group.avatar_emoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-50">{group.name}</p>
              <p className="text-xs text-neutral-400">
                {group.member_count} member{group.member_count !== 1 ? "s" : ""}
                {group.tag && <span className="ml-2">&middot; {group.tag}</span>}
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1">
            <div className="h-4 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        )}
      </div>

      {/* Error toast */}
      {error && group && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-800 dark:bg-red-950">
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Message feed */}
      <div
        ref={feedRef}
        className="flex-1 space-y-4 overflow-y-auto p-4"
        aria-live="polite"
        aria-label="Group messages"
      >
        {loadingMessages ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
            <span className="text-4xl">👥</span>
            <p className="mt-2 text-sm">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isOwn={msg.sender_id === currentUserId}
            />
          ))
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <form onSubmit={sendMessage} className="flex items-center gap-1.5 p-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            maxLength={2000}
            className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
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
    </div>
  );
}
