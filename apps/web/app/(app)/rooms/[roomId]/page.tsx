"use client";

/**
 * app/(app)/rooms/[roomId]/page.tsx
 *
 * Room detail page (web version).
 * Two-column layout: main message feed + sidebar (room info, creator, top gifters).
 * Supports VIP subscribe overlay and Drop entry fee notices.
 * Polls for new messages every 3 seconds.
 *
 * TODO: Replace polling with Supabase Realtime channel subscription:
 *   const channel = supabase.channel(`room:${roomId}`)
 *     .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, handleNewMessage)
 *     .subscribe();
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TopGifters } from "@/components/rooms/TopGifters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoomType = "public" | "vip" | "drop" | "classroom" | "guild";

interface RoomInfo {
  id: string;
  name: string;
  description: string;
  type: RoomType;
  creatorId: string;
  creatorUsername: string;
  creatorAvatarEmoji: string;
  memberCount: number;
  isSubscribed: boolean;
  entryFeePaid: boolean;
  subscriptionPrice: number; // coins
  entryFee: number; // coins
  dropExpiresAt: string | null;
  coverEmoji: string;
}

interface Message {
  id: string;
  userId: string;
  username: string;
  avatarEmoji: string;
  content: string;
  createdAt: string;
  giftEmoji?: string;
  giftAmount?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

function secondsRemaining(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function formatCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function RoomSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-4 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
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
  msg: Message;
  isOwn: boolean;
}

function MessageBubble({ msg, isOwn }: MessageBubbleProps) {
  return (
    <div className={`flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""}`}>
      <span className="mt-1 h-8 w-8 shrink-0 rounded-full bg-neutral-100 text-center text-lg leading-8 dark:bg-neutral-800">
        {msg.avatarEmoji}
      </span>
      <div className={`max-w-[75%] ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
        <div className="flex items-baseline gap-1.5">
          {!isOwn && (
            <Link href={`/profile/${msg.userId}`} className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
              @{msg.username}
            </Link>
          )}
          <span className="text-xs text-neutral-400">{timeAgo(msg.createdAt)}</span>
        </div>
        <div className={`mt-0.5 rounded-2xl px-3.5 py-2 text-sm ${isOwn ? "rounded-tr-sm bg-blue-600 text-white" : "rounded-tl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"}`}>
          {msg.giftEmoji && (
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold opacity-80">
              <span>{msg.giftEmoji}</span>
              <span>Gift · {msg.giftAmount} coins</span>
            </div>
          )}
          {msg.content}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VIP overlay
// ---------------------------------------------------------------------------

interface VipOverlayProps {
  price: number;
  previewMessages: Message[];
  onSubscribe: () => void;
  subscribing: boolean;
}

function VipOverlay({ price, previewMessages, onSubscribe, subscribing }: VipOverlayProps) {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Blurred preview */}
      <div className="pointer-events-none flex-1 overflow-hidden p-4">
        {previewMessages.map((msg) => (
          <div key={msg.id} className="mb-3 blur-sm select-none">
            <MessageBubble msg={msg} isOwn={false} />
          </div>
        ))}
      </div>
      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-neutral-900/80">
        <div className="mx-4 rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-4xl">🔒</span>
          <h3 className="mt-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">VIP Room</h3>
          <p className="mt-1 text-sm text-neutral-500">Subscribe to access this room</p>
          <p className="mt-2 text-2xl font-bold text-amber-600">{price.toLocaleString()} <span className="text-base">coins</span></p>
          <button
            onClick={onSubscribe}
            disabled={subscribing}
            className="mt-4 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {subscribing ? "Processing…" : "Subscribe Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drop countdown
// ---------------------------------------------------------------------------

function DropNotice({ expiresAt, entryFee, onPay, paying, paid }: {
  expiresAt: string;
  entryFee: number;
  onPay: () => void;
  paying: boolean;
  paid: boolean;
}) {
  const [secs, setSecs] = useState(secondsRemaining(expiresAt));

  useEffect(() => {
    const id = setInterval(() => setSecs(secondsRemaining(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (paid) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            ⏱ Drop room — ends in <span className="tabular-nums">{formatCountdown(secs)}</span>
          </p>
          <p className="text-xs text-amber-600">Entry fee: {entryFee.toLocaleString()} coins</p>
        </div>
        <button
          onClick={onPay}
          disabled={paying || secs === 0}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {paying ? "Processing…" : "Pay Entry Fee"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Room detail page with real-time message feed.
 */
export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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

  // Fetch room info
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}`, { credentials: "include" });
        if (res.status === 401) { router.push("/login"); return; }
        if (!res.ok) throw new Error("Room not found");
        setRoom((await res.json()) as RoomInfo);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error loading room");
      } finally {
        setLoadingRoom(false);
      }
    })();
  }, [roomId, router]);

  // Fetch messages + poll
  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}/messages`, { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { messages: Message[] };
    setMessages(data.messages);
    setLoadingMessages(false);
  }, [roomId]);

  useEffect(() => {
    void fetchMessages();
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => clearInterval(pollRef.current);
  }, [fetchMessages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: input.trim() }),
      });
      if (!res.ok) throw new Error("Failed to send");
      setInput("");
      await fetchMessages();
    } catch { /* ignore */ }
    setSending(false);
  }

  async function handleSubscribe() {
    setSubscribing(true);
    try {
      await fetch(`/api/rooms/${roomId}/subscribe`, { method: "POST", credentials: "include" });
      setRoom((r) => r ? { ...r, isSubscribed: true } : r);
    } catch { /* ignore */ }
    setSubscribing(false);
  }

  async function handlePayEntry() {
    setPaying(true);
    try {
      await fetch(`/api/rooms/${roomId}/pay-entry`, { method: "POST", credentials: "include" });
      setRoom((r) => r ? { ...r, entryFeePaid: true } : r);
    } catch { /* ignore */ }
    setPaying(false);
  }

  const canAccess =
    !room ||
    room.type === "public" ||
    room.type === "guild" ||
    room.type === "classroom" ||
    (room.type === "vip" && room.isSubscribed) ||
    (room.type === "drop" && room.entryFeePaid);

  const previewMessages = messages.slice(-3);

  if (loadingRoom) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-neutral-500">{error ?? "Room not found"}</p>
        <Link href="/rooms" className="text-sm text-blue-600 hover:underline">← Back to Rooms</Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden lg:flex-row">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Room header */}
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-2xl">{room.coverEmoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold text-neutral-900 dark:text-neutral-50">{room.name}</h1>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold capitalize text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {room.type}
              </span>
            </div>
            <p className="truncate text-xs text-neutral-500">{room.memberCount.toLocaleString()} members</p>
          </div>
          <Link href="/rooms" className="text-xs text-blue-600 hover:underline dark:text-blue-400">← Rooms</Link>
        </div>

        {/* Drop notice */}
        {room.type === "drop" && room.dropExpiresAt && !room.entryFeePaid && (
          <DropNotice
            expiresAt={room.dropExpiresAt}
            entryFee={room.entryFee}
            onPay={handlePayEntry}
            paying={paying}
            paid={room.entryFeePaid}
          />
        )}

        {/* Message feed or VIP overlay */}
        {!canAccess && room.type === "vip" ? (
          <VipOverlay
            price={room.subscriptionPrice}
            previewMessages={previewMessages}
            onSubscribe={handleSubscribe}
            subscribing={subscribing}
          />
        ) : (
          <>
            <div
              ref={feedRef}
              className="flex-1 space-y-4 overflow-y-auto p-4"
              aria-live="polite"
              aria-label="Message feed"
            >
              {loadingMessages ? (
                <RoomSkeleton />
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
                  <span className="text-4xl">💬</span>
                  <p className="mt-2 text-sm">No messages yet. Be the first!</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} isOwn={msg.userId === currentUserId} />
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
                maxLength={500}
                disabled={!canAccess}
                className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <Link
                href={`/rooms/${roomId}/gift`}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-lg hover:bg-amber-200 dark:bg-amber-900"
                title="Send a gift"
              >
                🎁
              </Link>
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? "…" : "Send"}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 lg:flex">
        {/* Room info */}
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">About</h2>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{room.description || "No description."}</p>
        </div>

        {/* Creator card */}
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Creator</h2>
          <Link href={`/profile/${room.creatorId}`} className="flex items-center gap-2 hover:underline">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
              {room.creatorAvatarEmoji}
            </span>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">@{room.creatorUsername}</span>
          </Link>
        </div>

        {/* Top Gifters */}
        <TopGifters roomId={roomId} />
      </aside>
    </div>
  );
}
