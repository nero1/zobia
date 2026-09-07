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
import { authFetch } from "@/lib/api/authFetch";
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

interface GroupMember {
  user_id: string;
  role: string;
  can_invite: boolean;
  muted_until: string | null;
  muted_reason: string | null;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
}

const MUTE_DURATIONS: { minutes: number; labelKey: string }[] = [
  { minutes: 30, labelKey: "messages.groupChat.mute.30m" },
  { minutes: 60, labelKey: "messages.groupChat.mute.1h" },
  { minutes: 180, labelKey: "messages.groupChat.mute.3h" },
  { minutes: 1440, labelKey: "messages.groupChat.mute.1d" },
  { minutes: 4320, labelKey: "messages.groupChat.mute.3d" },
  { minutes: 10080, labelKey: "messages.groupChat.mute.7d" },
  { minutes: 43200, labelKey: "messages.groupChat.mute.30d" },
];

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
// Members panel — creator/any member can view the roster; admins get
// moderation actions (mute for a fixed duration or lift, remove).
// ---------------------------------------------------------------------------

function MembersPanel({
  groupId,
  currentUserId,
  isAdmin,
  onClose,
}: {
  groupId: string;
  currentUserId: string | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [muteTargetId, setMuteTargetId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      const res = await authFetch(`/api/messages/group/${groupId}/members`);
      if (!res.ok) return;
      const data = (await res.json()) as { data?: GroupMember[] };
      setMembers(data.data ?? []);
    } catch { /* non-fatal */ }
  }, [groupId]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  async function handleRemove(userId: string) {
    setBusyUserId(userId);
    try {
      await authFetch(`/api/messages/group/${groupId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      await loadMembers();
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleMute(userId: string, durationMinutes: number | null) {
    setBusyUserId(userId);
    try {
      await authFetch(`/api/messages/group/${groupId}/members/${userId}/mute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMinutes }),
      });
      setMuteTargetId(null);
      await loadMembers();
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">{t("messages.groupChat.members.title")}</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" aria-label={t("action.close")}>✕</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {members === null ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : (
            members.map((m) => {
              const isMuted = !!m.muted_until && new Date(m.muted_until) > new Date();
              return (
                <div key={m.user_id} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-800">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
                    {m.avatar_emoji ?? "👤"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {m.display_name || `@${m.username}`}
                      {m.role === "admin" && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          {t("messages.groupChat.members.admin")}
                        </span>
                      )}
                      {isMuted && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                          {t("messages.groupChat.members.muted")}
                        </span>
                      )}
                    </p>
                  </div>
                  {isAdmin && m.user_id !== currentUserId && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isMuted ? (
                        <button
                          onClick={() => void handleMute(m.user_id, null)}
                          disabled={busyUserId === m.user_id}
                          className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
                        >
                          {t("messages.groupChat.members.liftSuspension")}
                        </button>
                      ) : (
                        <div className="relative">
                          <button
                            onClick={() => setMuteTargetId(muteTargetId === m.user_id ? null : m.user_id)}
                            className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
                          >
                            {t("messages.groupChat.members.suspend")}
                          </button>
                          {muteTargetId === m.user_id && (
                            <div className="absolute right-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                              {MUTE_DURATIONS.map((d) => (
                                <button
                                  key={d.minutes}
                                  onClick={() => void handleMute(m.user_id, d.minutes)}
                                  className="block w-full px-3 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                                >
                                  {t(d.labelKey)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => void handleRemove(m.user_id)}
                        disabled={busyUserId === m.user_id}
                        className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400"
                      >
                        {t("messages.groupChat.members.remove")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
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
  const [showMembers, setShowMembers] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Soft concurrent-presence cap (mirrors Rooms) — null until the first heartbeat resolves.
  const [presenceFull, setPresenceFull] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Prevent body scroll on iOS PWA so touch events reach the feed container.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

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
        if (!res.ok) throw new Error(t("messages.groupChat.notFound"));
        const data = (await res.json()) as { items?: GroupInfo[] };
        const found = (data.items ?? []).find((g) => g.id === groupId);
        if (found) setGroup(found);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("messages.groupChat.loadError"));
      } finally {
        setLoadingGroup(false);
      }
    })();
  }, [groupId, router]);

  // Live-presence heartbeat — soft concurrent cap (mirrors Rooms). Admins/
  // creator always pass server-side; a full response disables the composer
  // rather than blocking the whole page (members can still read history).
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    async function heartbeat() {
      try {
        const res = await authFetch(`/api/messages/group/${groupId}/presence`, { method: "POST" });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { full?: boolean };
        setPresenceFull(!!data.full);
      } catch { /* non-fatal — fail open, matches server-side fail-open */ }
    }
    void heartbeat();
    const interval = setInterval(() => void heartbeat(), 45_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [groupId]);

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

  const fetchMessages = useCallback(async (): Promise<boolean> => {
    try {
      // Delta fetch after the first load — only messages newer than the latest.
      const after = latestCreatedAtRef.current;
      const url = after
        ? `/api/messages/group/${groupId}?after=${encodeURIComponent(after)}`
        : `/api/messages/group/${groupId}`;
      // authFetch silently refreshes on 401 and raises the app-wide "signed out"
      // notice if the session is truly gone.
      const res = await authFetch(url);
      if (!res.ok) return false;
      const data = (await res.json()) as { data?: GroupMessage[] };
      const incoming = data.data ?? [];
      mergeIncoming(incoming);
      // Activity signal drives the poll's idle backoff.
      return incoming.length > 0;
    } catch { /* ignore */ return false; } finally {
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
  const { pokePoll } = useAdaptiveChatPoll({
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
      const res = await authFetch(`/api/messages/group/${groupId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: optimisticMsg.content, messageType: "text" }),
      });
      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        const d = (await res.json()) as { message?: string; error?: { code?: string; message?: string } };
        const code = d.error?.code ?? null;
        const message = d.error?.message ?? d.message ?? t("messages.conversation.failedToSend");
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
      // Snap the poll back to fast cadence so a reply is picked up promptly.
      pokePoll();
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || t("messages.conversation.failedToSend")) : t("messages.conversation.failedToSend"));
      setTimeout(() => setError(null), 3000);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleLeaveGroup() {
    setShowMenu(false);
    if (!currentUserId) return;
    try {
      await authFetch(`/api/messages/group/${groupId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId }),
      });
      router.push("/messages/groups");
    } catch { /* non-fatal — user can retry */ }
  }

  async function handleBlockGroup() {
    setShowMenu(false);
    try {
      await authFetch(`/api/messages/group/${groupId}/block`, { method: "POST" });
      router.push("/messages/groups");
    } catch { /* non-fatal — user can retry */ }
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
        <Link href="/messages/groups" className="text-sm text-blue-600 hover:underline">{t("messages.groupChat.backToGroups")}</Link>
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
          aria-label={t("messages.groupChat.backToGroups")}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        {group ? (
          <>
            <button
              onClick={() => setShowMembers(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800"
              aria-label={t("messages.groupChat.members.title")}
            >
              {group.avatar_emoji}
            </button>
            <button onClick={() => setShowMembers(true)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-50">{group.name}</p>
              <p className="text-xs text-neutral-400">
                {t("messages.groupChat.memberCount", { count: group.member_count })}
                {group.tag && <span className="ml-2">&middot; {group.tag}</span>}
              </p>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label={t("messages.groupChat.moreOptions")}
              >
                ⋮
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                  <button
                    onClick={() => { setShowMenu(false); setShowMembers(true); }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {t("messages.groupChat.members.title")}
                  </button>
                  <button
                    onClick={() => void handleLeaveGroup()}
                    className="block w-full px-4 py-2.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {t("messages.groupChat.leaveGroup")}
                  </button>
                  <button
                    onClick={() => void handleBlockGroup()}
                    className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    {t("messages.groupChat.blockGroup")}
                  </button>
                </div>
              )}
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

      {/* Concurrent-capacity full notice — mirrors Rooms; membership is unaffected, only live posting is paused */}
      {presenceFull && group?.user_role !== "admin" && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-xs text-amber-700 dark:text-amber-300">{t("messages.groupChat.full")}</p>
        </div>
      )}

      {/* Message feed */}
      <div
        ref={feedRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
        aria-live="polite"
        aria-label={t("messages.groupChat.ariaLabel")}
      >
        {loadingMessages ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
            <span className="text-4xl">👥</span>
            <p className="mt-2 text-sm">{t("messages.groupChat.noMessagesYet")}</p>
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

      {/* Input bar — disabled while the concurrent cap is full (non-admin) */}
      <div className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <form onSubmit={sendMessage} className="flex items-center gap-1.5 p-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("messages.typeHere")}
            maxLength={2000}
            disabled={presenceFull && group?.user_role !== "admin"}
            className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending || (presenceFull && group?.user_role !== "admin")}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? "…" : t("messages.send")}
          </button>
        </form>
      </div>

      {showMembers && group && (
        <MembersPanel
          groupId={groupId}
          currentUserId={currentUserId}
          isAdmin={group.user_role === "admin"}
          onClose={() => setShowMembers(false)}
        />
      )}
    </div>
  );
}
