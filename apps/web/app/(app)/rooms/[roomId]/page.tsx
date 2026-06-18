"use client";

/**
 * app/(app)/rooms/[roomId]/page.tsx
 *
 * Room detail page (web version).
 * Two-column layout: main message feed + sidebar (room info, creator, top gifters).
 * Supports VIP subscribe overlay and Drop entry fee notices.
 *
 * Live message delivery mirrors the DM/group pages: a 3-second baseline poll
 * (guaranteed, provider-independent) merged with an optional realtime push via
 * `useRealtimeChannel` ("room:<id>:messages"). Both are deduped by message id
 * and the feed is kept in chronological order. The sender's own message is
 * echoed immediately from the POST response so it appears without delay.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { TopGifters } from "@/components/rooms/TopGifters";
import { LiveRoomPulseBar } from "@/components/ui/LiveRoomPulseBar";
import { useRealtimeChannel } from "@/lib/realtime/useRealtimeChannel";
import { useAdaptiveChatPoll } from "@/lib/hooks/useAdaptiveChatPoll";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { readCachedMessages, writeCachedMessages } from "@/lib/chat/messageCache";

// Resolved at build time. When undefined there is no push provider configured
// and the 3-second baseline poll is the sole live channel.
const REALTIME_PROVIDER = process.env.NEXT_PUBLIC_REALTIME_PROVIDER;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Canonical room types per PRD §10
type RoomType = "free_open" | "vip" | "drop" | "tipping" | "classroom" | "guild";

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
  minGiftSpectacleCoin?: number; // gifts above this value trigger room-wide spectacle
}

interface TopGifterRow {
  userId: string;
  username: string;
  avatarEmoji: string;
  totalCoins: number;
}

interface GiftSpectacleState {
  senderUsername: string;
  senderAvatarEmoji: string;
  giftName: string;
  giftEmoji: string;
  coinValue: number;
}

interface ReplayHighlight {
  content: string;
  sender: string;
  timestamp: string;
}

interface DropReplay {
  id: string;
  title: string;
  highlights: ReplayHighlight[];
  replayFeeKobo: number;
  isPublished: boolean;
  publishedAt: string | null;
}

interface Message {
  id: string;
  userId: string;
  username: string;
  displayName?: string;
  avatarEmoji: string;
  senderIsCreator?: boolean;
  content: string;
  createdAt: string;
  giftEmoji?: string;
  giftAmount?: number;
  message_type?: "text" | "moment" | "gif" | "sticker";
}

// Chronological ascending sort (oldest first → newest at the bottom of the feed).
// The REST endpoint returns newest-first, so the client must re-sort before render.
function sortByCreatedAtAsc(a: Message, b: Message): number {
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
// ClassRoom Curriculum component (PRD §10)
// ---------------------------------------------------------------------------

interface ClassroomModule {
  id: string;
  title: string;
  description?: string;
  order: number;
}

interface ClassroomData {
  courseTitle: string;
  startDate: string | null;
  endDate: string | null;
  modules: ClassroomModule[];
  isEnrolled: boolean;
  isGraduate: boolean;
  graduatesCount: number;
  completedModuleIds: string[];
  enrolmentFee: number;
}

function ClassRoomCurriculum({
  roomId,
  isCreator,
}: {
  roomId: string;
  isCreator: boolean;
}) {
  const [data, setData] = useState<ClassroomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const currency = useCurrency();
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/classroom/${roomId}`, { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: ClassroomData; classroom?: ClassroomData };
        const cd = json.data ?? json.classroom ?? null;
        if (cd) {
          setData(cd);
          setCompletedIds(new Set(cd.completedModuleIds ?? []));
        }
      } catch { /* non-fatal */ } finally {
        setLoading(false);
      }
    })();
  }, [roomId]);

  async function handleEnroll() {
    setEnrolling(true);
    try {
      const res = await fetch(`/api/classroom/${roomId}/enroll`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: "balance" }),
      });
      if (res.ok) setData((d) => (d ? { ...d, isEnrolled: true } : d));
    } catch { /* ignore */ }
    setEnrolling(false);
  }

  function toggleModule(moduleId: string) {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  async function handleCertificate() {
    try {
      const res = await fetch(`/api/classroom/${roomId}/certificate`, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      }
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="mb-2 h-3 w-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isEnded = data.endDate ? new Date(data.endDate) < new Date() : false;

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        🎓 Curriculum
      </h2>
      <p className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {data.courseTitle}
      </p>
      {(data.startDate || data.endDate) && (
        <p className="mb-2 text-xs text-neutral-500">
          {data.startDate ? new Date(data.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
          {data.startDate && data.endDate ? " – " : ""}
          {data.endDate ? new Date(data.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
        </p>
      )}
      {(data.modules ?? []).length > 0 && (
        <div className="mb-3 space-y-1.5">
          {(data.modules ?? []).slice().sort((a, b) => a.order - b.order).map((mod) => (
            <label key={mod.id} className="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800">
              <input
                type="checkbox"
                checked={completedIds.has(mod.id)}
                onChange={() => (data.isEnrolled ? toggleModule(mod.id) : undefined)}
                disabled={!data.isEnrolled && !isCreator}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-400 accent-blue-600"
              />
              <span className={`text-xs leading-tight ${completedIds.has(mod.id) ? "text-neutral-400 line-through" : "text-neutral-700 dark:text-neutral-300"}`}>
                {mod.title}
              </span>
            </label>
          ))}
        </div>
      )}
      {isEnded && data.graduatesCount > 0 && (
        <p className="mb-2 text-xs text-teal-600 dark:text-teal-400">
          🎓 {data.graduatesCount.toLocaleString()} graduate{data.graduatesCount !== 1 ? "s" : ""}
        </p>
      )}
      {data.isGraduate && (
        <button type="button" onClick={handleCertificate} className="mb-2 w-full rounded-lg bg-teal-600 py-2 text-xs font-semibold text-white hover:bg-teal-700">
          📜 Download Certificate
        </button>
      )}
      {!data.isEnrolled && !isCreator && (
        <button type="button" onClick={handleEnroll} disabled={enrolling} className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {enrolling ? "Enrolling…" : data.enrolmentFee > 0 ? `Enrol · ${data.enrolmentFee.toLocaleString()} ${currency.softPlural.toLowerCase()}` : "Enrol (Free)"}
        </button>
      )}
      {data.isEnrolled && !data.isGraduate && (
        <p className="text-xs text-teal-600 dark:text-teal-400">✓ You are enrolled</p>
      )}
    </div>
  );
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
  const currency = useCurrency();
  // GIF/sticker messages carry the media in `content` (a URL or an emoji).
  // Rendering those as plain text overflowed the viewport on mobile, so render
  // them as proper media instead.
  const isGif = msg.message_type === "gif";
  const isSticker = msg.message_type === "sticker";
  return (
    <div className={`flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""}`}>
      <span className="mt-1 h-8 w-8 shrink-0 rounded-full bg-neutral-100 text-center text-lg leading-8 dark:bg-neutral-800">
        {msg.avatarEmoji}
      </span>
      <div className={`flex min-w-0 max-w-[75%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
        <div className="flex items-baseline gap-1.5">
          {!isOwn && (
            <Link href={`/profile/${msg.userId}`} className="max-w-[40vw] truncate text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
              @{msg.username}
            </Link>
          )}
          <span className="shrink-0 text-xs text-neutral-400">{timeAgo(msg.createdAt)}</span>
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
          <div className={`mt-0.5 overflow-hidden whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
            msg.message_type === "moment"
              ? "border-2 border-purple-400 bg-purple-50 text-purple-900 dark:border-purple-600 dark:bg-purple-950/50 dark:text-purple-100"
              : isOwn
                ? "rounded-tr-sm bg-blue-600 text-white"
                : "rounded-tl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          }`}>
            {msg.giftEmoji && (
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold opacity-80">
                <span>{msg.giftEmoji}</span>
                <span>Gift · {msg.giftAmount} {currency.softPlural.toLowerCase()}</span>
              </div>
            )}
            {msg.content}
            {msg.message_type === "moment" && (
              <div className="mt-1 text-xs font-semibold text-purple-500 dark:text-purple-400">⚡ Moment · 24h</div>
            )}
          </div>
        )}
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
  subscribeError?: string | null;
}

function VipOverlay({ price, previewMessages, onSubscribe, subscribing, subscribeError }: VipOverlayProps) {
  const currency = useCurrency();
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
          {price > 0 && (
            <p className="mt-2 text-2xl font-bold text-amber-600">{price.toLocaleString()} <span className="text-base">{currency.softPlural.toLowerCase()}</span></p>
          )}
          {subscribeError && (
            <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{subscribeError}</p>
          )}
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
  const currency = useCurrency();

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
          <p className="text-xs text-amber-600">Entry fee: {entryFee.toLocaleString()} {currency.softPlural.toLowerCase()}</p>
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
// Types for rich input
// ---------------------------------------------------------------------------

interface GifResult { id: string; url: string; previewUrl: string; title: string; }
interface StickerPackRoom { id: string; name: string; coverEmoji: string; stickers: Array<{ id: string; emoji: string; name: string }>; isUnlocked: boolean; }

// ---------------------------------------------------------------------------
// GIF Picker (Room)
// ---------------------------------------------------------------------------

function RoomGifPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/messages/gif?q=${encodeURIComponent(q)}&limit=12`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { gifs?: GifResult[] };
      setResults(data.gifs ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query || "trending"); }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-semibold text-neutral-500">GIFs</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" aria-label="Close GIF picker">✕</button>
      </div>
      <div className="p-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search GIFs…"
          className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" autoFocus />
      </div>
      <div className="grid max-h-52 grid-cols-3 gap-1 overflow-y-auto p-2">
        {loading ? (
          Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-700" />
          ))
        ) : results.length === 0 ? (
          <div className="col-span-3 py-6 text-center text-xs text-neutral-400">Type to search GIFs</div>
        ) : results.map((gif) => (
          <button key={gif.id} onClick={() => onSelect(gif.url)} className="aspect-square overflow-hidden rounded-lg hover:opacity-80" title={gif.title}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gif.previewUrl || gif.url} alt={gif.title} className="h-full w-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticker Picker (Room)
// ---------------------------------------------------------------------------

function RoomStickerPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const [packs, setPacks] = useState<StickerPackRoom[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/stickers", { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json() as { data?: { packs?: Array<Record<string, unknown>> }; packs?: Array<Record<string, unknown>> };
        const rows = json.data?.packs ?? json.packs ?? [];
        const unlocked: StickerPackRoom[] = rows
          .filter((r) => r.unlocked ?? r.isUnlocked)
          .map((r) => ({
            id: r.id as string,
            name: r.name as string,
            coverEmoji: (r.cover_sticker_url ?? r.coverEmoji ?? "🎨") as string,
            stickers: (r.stickers ?? []) as StickerPackRoom["stickers"],
            isUnlocked: true,
          }));
        setPacks(unlocked);
        if (unlocked.length > 0) setActivePack(unlocked[0].id);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  const currentPack = packs.find((p) => p.id === activePack);
  return (
    <div className="absolute bottom-full left-10 z-20 mb-2 w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-semibold text-neutral-500">Stickers</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" aria-label="Close">✕</button>
      </div>
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : packs.length === 0 ? (
        <div className="p-4 text-center text-xs text-neutral-500">No sticker packs unlocked yet.</div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 p-1.5 dark:border-neutral-700">
            {packs.map((pack) => (
              <button key={pack.id} onClick={() => setActivePack(pack.id)} title={pack.name}
                className={`shrink-0 rounded-lg px-2 py-1 text-lg ${activePack === pack.id ? "bg-blue-100 dark:bg-blue-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
                {pack.coverEmoji}
              </button>
            ))}
          </div>
          <div className="grid max-h-44 grid-cols-4 gap-1 overflow-y-auto p-2">
            {(currentPack?.stickers ?? []).map((sticker) => (
              <button key={sticker.id} onClick={() => onSelect(sticker.emoji)} title={sticker.name}
                className="flex aspect-square items-center justify-center rounded-lg text-3xl hover:bg-neutral-100 dark:hover:bg-neutral-800">
                {sticker.emoji}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room Powers Panel (PRD §11 — Message Pin, Spotlight, Member Highlight)
// ---------------------------------------------------------------------------

function RoomPowersPanel({
  roomId,
  onClose,
  currentUserId,
  lastOwnMessageId,
}: { roomId: string; onClose: () => void; currentUserId: string | null; lastOwnMessageId: string | null }) {
  const [activating, setActivating] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const currency = useCurrency();

  const POWERS = [
    { type: "message_pin",      emoji: "📌", label: "Pin Message",       description: "Pin your last message at the top for 1 hour", coins: 100 },
    { type: "room_spotlight",   emoji: "🔦", label: "Room Spotlight",    description: "Feature this room in discovery for 6 hours",  coins: 500 },
    { type: "member_highlight", emoji: "⭐", label: "Member Highlight",  description: "Highlight yourself in the room for 1 hour",    coins: 200 },
  ];

  async function activate(powerType: string) {
    // Validate required fields before hitting the API
    if (powerType === "message_pin" && !lastOwnMessageId) {
      setResult("❌ Send a message first to pin it");
      return;
    }

    setActivating(powerType);
    setResult(null);
    try {
      // Build the body with the required discriminated-union fields
      const body: Record<string, unknown> = { power: powerType };
      if (powerType === "message_pin") {
        body.messageId = lastOwnMessageId;
      } else if (powerType === "room_spotlight") {
        body.durationHours = 24;
      } else if (powerType === "member_highlight") {
        body.targetUserId = currentUserId;
        body.durationMinutes = 60;
      }

      const res = await fetch(`/api/rooms/${roomId}/powers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as { error?: { message?: string }; message?: string };
      setResult(res.ok ? "✅ Power activated!" : `❌ ${d.error?.message ?? d.message ?? "Failed"}`);
    } catch { setResult("❌ Network error"); }
    setActivating(null);
  }

  return (
    <div className="absolute bottom-full right-0 z-20 mb-2 w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-semibold text-neutral-500">⚡ Room Powers</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" aria-label="Close">✕</button>
      </div>
      {result && (
        <div className="px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">{result}</div>
      )}
      <div className="p-2">
        {POWERS.map((power) => (
          <button
            key={power.type}
            onClick={() => void activate(power.type)}
            disabled={activating === power.type}
            className="flex w-full items-start gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-50 disabled:opacity-60 dark:hover:bg-neutral-800"
          >
            <span className="text-2xl">{power.emoji}</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{power.label}</p>
              <p className="text-xs text-neutral-500">{power.description}</p>
            </div>
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-200">
              🪙 {power.coins} {currency.softPlural.toLowerCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room Input Bar (composite — text + GIF + stickers + gift + powers)
// ---------------------------------------------------------------------------

interface RoomInputBarProps {
  roomId: string;
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  canAccess: boolean;
  currentUserId: string | null;
  lastOwnMessageId: string | null;
  isMoment: boolean;
  onMomentToggle: () => void;
  onSend: (e: React.FormEvent) => void;
  onMessageSent: (msg: Message) => void;
}

function RoomInputBar({
  roomId,
  input,
  setInput,
  sending,
  canAccess,
  currentUserId,
  lastOwnMessageId,
  isMoment,
  onMomentToggle,
  onSend,
  onMessageSent,
}: RoomInputBarProps) {
  const { t } = useTranslation();
  const [showGif, setShowGif] = useState(false);
  const [showSticker, setShowSticker] = useState(false);
  const [showPowers, setShowPowers] = useState(false);
  const [showMobileExtras, setShowMobileExtras] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-roompicker]")) {
        setShowGif(false);
        setShowSticker(false);
        setShowPowers(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function sendSpecial(content: string, contentType: "gif" | "sticker") {
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, contentType }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { message?: Message };
      if (data.message) onMessageSent(data.message);
    } catch { /* ignore */ }
    setShowGif(false);
    setShowSticker(false);
    setShowMobileExtras(false);
    inputRef.current?.focus();
  }

  function toggle(panel: "gif" | "sticker" | "powers") {
    setShowGif(panel === "gif" ? (v) => !v : false);
    setShowSticker(panel === "sticker" ? (v) => !v : false);
    setShowPowers(panel === "powers" ? (v) => !v : false);
  }

  return (
    <div data-roompicker className="relative border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      {showGif && (
        <RoomGifPicker
          onSelect={(url) => { void sendSpecial(url, "gif"); }}
          onClose={() => setShowGif(false)}
        />
      )}
      {showSticker && (
        <RoomStickerPicker
          onSelect={(emoji) => { void sendSpecial(emoji, "sticker"); }}
          onClose={() => setShowSticker(false)}
        />
      )}
      {showPowers && (
        <RoomPowersPanel
          roomId={roomId}
          onClose={() => setShowPowers(false)}
          currentUserId={currentUserId}
          lastOwnMessageId={lastOwnMessageId}
        />
      )}

      {/* Moment mode indicator */}
      {isMoment && (
        <div className="flex items-center gap-1.5 border-b border-purple-200 bg-purple-50 px-3 py-1.5 dark:border-purple-900 dark:bg-purple-950/40">
          <span className="text-sm">⚡</span>
          <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">Moment · disappears in 24h</span>
          <button type="button" onClick={onMomentToggle} className="ml-auto text-xs text-purple-500 hover:text-purple-700 dark:hover:text-purple-300">Cancel</button>
        </div>
      )}

      {/* Mobile extras bar — shown when + is tapped */}
      {showMobileExtras && (
        <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-800/50 sm:hidden">
          <button type="button" onClick={() => { toggle("gif"); setShowMobileExtras(false); }}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            aria-label="GIF" title="GIF" disabled={!canAccess}>GIF</button>
          <button type="button" onClick={() => { toggle("sticker"); setShowMobileExtras(false); }}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            aria-label="Stickers" title="Stickers" disabled={!canAccess}>😊</button>
          <button type="button" onClick={() => { onMomentToggle(); setShowMobileExtras(false); }}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${isMoment ? "bg-purple-100 text-purple-700 dark:bg-purple-900" : "text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"}`}
            title="Moment (24h)" aria-label="Toggle Moment mode" disabled={!canAccess}>🌟</button>
          <a href={`/rooms/${roomId}/gift`}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-neutral-500 hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-900/30"
            title="Send a gift" aria-label="Send a gift" onClick={() => setShowMobileExtras(false)}>🎁</a>
          <button type="button" onClick={() => { toggle("powers"); setShowMobileExtras(false); }}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${showPowers ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900" : "text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"}`}
            aria-label="Room Powers" title="Room Powers" disabled={!canAccess}>⚡</button>
        </div>
      )}

      <form onSubmit={onSend} className="flex items-center gap-1.5 p-3">
        {/* Mobile: + toggle button for extras */}
        <button
          type="button"
          onClick={() => setShowMobileExtras((v) => !v)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold transition-colors sm:hidden ${showMobileExtras ? "bg-blue-100 text-blue-700 dark:bg-blue-900" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          aria-label={t("room.moreOptions")}
          disabled={!canAccess}
        >
          {showMobileExtras ? "✕" : "+"}
        </button>

        {/* Desktop: GIF button */}
        <button type="button" onClick={() => toggle("gif")}
          className={`hidden sm:flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold transition-colors ${showGif ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          aria-label="GIF" title="GIF" disabled={!canAccess}>
          GIF
        </button>

        {/* Desktop: Sticker button */}
        <button type="button" onClick={() => toggle("sticker")}
          className={`hidden sm:flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${showSticker ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          aria-label="Stickers" title="Stickers" disabled={!canAccess}>
          😊
        </button>

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isMoment ? "Send a moment (24h)…" : "Type a message…"}
          maxLength={500}
          disabled={!canAccess}
          className={`min-w-0 flex-1 rounded-xl border bg-neutral-50 px-4 py-2.5 text-base focus:outline-none focus:ring-1 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 ${
            isMoment
              ? "border-purple-400 focus:border-purple-500 focus:ring-purple-500 dark:border-purple-600"
              : "border-neutral-300 focus:border-blue-500 focus:ring-blue-500 dark:border-neutral-700"
          }`}
        />

        {/* Desktop: Moment toggle */}
        <button type="button" onClick={onMomentToggle} title="Moment (24h)" aria-label="Toggle Moment mode" disabled={!canAccess}
          className={`hidden sm:flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${isMoment ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
          🌟
        </button>

        {/* Desktop: Gift */}
        <a href={`/rooms/${roomId}/gift`}
          className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg text-xl text-neutral-400 hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-900/30"
          title="Send a gift" aria-label="Send a gift">
          🎁
        </a>

        {/* Desktop: Room Powers */}
        <button type="button" onClick={() => toggle("powers")}
          className={`hidden sm:flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${showPowers ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          aria-label="Room Powers" title="Room Powers" disabled={!canAccess}>
          ⚡
        </button>

        {/* Send */}
        <button type="submit" disabled={!input.trim() || sending || !canAccess}
          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SpectacleThresholdPanel — creator gift spectacle settings (PRD §12)
// ---------------------------------------------------------------------------

/**
 * Panel shown only to the room creator allowing them to set the minimum
 * gift value (in coins) required to trigger the full room-wide spectacle
 * animation. Setting it to 0 or null uses the gift item's own threshold.
 */
function SpectacleThresholdPanel({
  roomId,
  initialThreshold,
}: {
  roomId: string;
  initialThreshold: number | null;
}) {
  const { t } = useTranslation();
  const [threshold, setThreshold] = useState<string>(
    initialThreshold != null ? String(initialThreshold) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    const coins = threshold.trim() === "" ? null : parseInt(threshold, 10);
    try {
      const res = await fetch(`/api/rooms/${roomId}/spectacle-threshold`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdCoins: coins }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string | { code?: string; message?: string } };
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
        const err = new Error(errMsg ?? "Failed to save") as Error & { code?: string | null };
        err.code = errCode;
        throw err;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const e = err as Error & { code?: string | null };
      setError(err instanceof Error ? translateApiError(t, e.code, e.message || "Error saving") : "Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        🎁 Spectacle Threshold
      </h2>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        Gifts above this value trigger a full room-wide spectacle animation. Leave blank to use
        each gift item&apos;s default.
      </p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">🪙</span>
          <input
            type="number"
            min="0"
            max="10000"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="e.g. 50"
            className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-8 pr-3 text-sm
                       dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white
                     hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}

/**
 * RoomCapacityPanel — creator-only control to raise the room's soft participant
 * cap by spending coins (PRD §10). Each step adds slots for a fixed coin cost;
 * both are admin-tunable via the manifest. Caps bound realtime fan-out.
 */
function RoomCapacityPanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [cap, setCap] = useState<number | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/pulse`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const d = (await res.json()) as { maxCapacity?: number };
        if (!cancelled && typeof d.maxCapacity === "number") setCap(d.maxCapacity);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  async function upgrade() {
    setUpgrading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/capacity`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: 1 }),
      });
      const d = (await res.json()) as {
        data?: { maxMembers?: number; coinsSpent?: number };
        error?: { code?: string; message?: string };
      };
      if (res.ok && d.data?.maxMembers) {
        setCap(d.data.maxMembers);
        setMsg(t("room.capacityUpgraded", { n: d.data.maxMembers }));
      } else {
        setMsg(translateApiError(t, d.error?.code ?? null, d.error?.message ?? t("room.capacityUpgradeFailed")));
      }
    } catch {
      setMsg(t("room.capacityUpgradeFailed"));
    } finally {
      setUpgrading(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        👥 {t("room.capacityTitle")}
      </h2>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        {t("room.capacityHelp", { n: cap ?? 0 })}
      </p>
      <button
        type="button"
        onClick={upgrade}
        disabled={upgrading}
        className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {upgrading ? "…" : t("room.capacityUpgradeCta")}
      </button>
      {msg && <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400">{msg}</p>}
      <p className="mt-1 text-[10px] text-neutral-400">{currency.softPlural}</p>
    </div>
  );
}

/**
 * Room detail page with real-time message feed.
 */
export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const roomId = params.roomId as string;
  const currency = useCurrency();

  const [room, setRoom] = useState<RoomInfo | null>(null);
  // Hydrate from the persisted cache for an instant first paint (and offline view).
  const [messages, setMessages] = useState<Message[]>(
    () => readCachedMessages<Message>(`room:${roomId}`) ?? []
  );
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(
    () => (readCachedMessages<Message>(`room:${roomId}`)?.length ?? 0) === 0
  );
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isMoment, setIsMoment] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [topGifter, setTopGifter] = useState<TopGifterRow | null>(null);
  // Gift spectacle overlay state (null = hidden)
  const [spectacle, setSpectacle] = useState<GiftSpectacleState | null>(null);
  // Drop Room replay
  const [replay, setReplay] = useState<DropReplay | null | "loading">("loading");
  const [replayPurchased, setReplayPurchased] = useState(false);
  const [purchasingReplay, setPurchasingReplay] = useState(false);
  const [publishingReplay, setPublishingReplay] = useState(false);
  const [replayTitle, setReplayTitle] = useState("");
  const [replayFeeCoins, setReplayFeeCoins] = useState(0);
  const [showPublishForm, setShowPublishForm] = useState(false);
  const spectacleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  // Newest message timestamp seen — drives delta polling (?after=).
  const latestCreatedAtRef = useRef<string | undefined>(undefined);
  const minGiftSpectacleCoinRef = useRef<number | null | undefined>(undefined);
  // Becomes true after the first message snapshot loads, so the gift spectacle
  // overlay only fires for genuinely-new gifts and not for the initial backlog.
  const initializedRef = useRef(false);

  // Keep minGiftSpectacleCoin ref in sync so the spectacle handler always reads
  // the latest creator-configured threshold.
  useEffect(() => {
    minGiftSpectacleCoinRef.current = room?.minGiftSpectacleCoin;
  }, [room?.minGiftSpectacleCoin]);

  // Prevent the body from scrolling while this chat page is mounted. Without
  // this, iOS Safari (PWA) may route touch-scroll events to the body instead
  // of the inner feed container, making the chat appear unscrollable.
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

  // Persist the latest messages so reopening the room paints instantly.
  useEffect(() => {
    if (messages.length) writeCachedMessages(`room:${roomId}`, messages);
  }, [messages, roomId]);

  // Poll top gifters every 30 seconds
  useEffect(() => {
    let cancelled = false;
    const fetchTopGifters = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/gifts`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { topGifters?: Array<{ user_id: string; username: string; avatar_emoji: string; total_coins: number }> };
        if (!cancelled && data.topGifters && data.topGifters.length > 0) {
          const g = data.topGifters[0];
          setTopGifter({ userId: g.user_id, username: g.username, avatarEmoji: g.avatar_emoji, totalCoins: g.total_coins });
        }
      } catch { /* non-fatal */ }
    };
    void fetchTopGifters();
    const id = setInterval(() => void fetchTopGifters(), 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [roomId]);

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
        if (res.status === 401) { router.push("/auth/login"); return; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
          const err = new Error(body.error?.message ?? "Room not found") as Error & { code?: string | null };
          err.code = body.error?.code ?? null;
          throw err;
        }
        const data = await res.json() as {
          room: {
            id: string;
            name: string;
            description: string | null;
            type: string;
            creator_id: string;
            creator_username: string;
            creator_avatar_emoji: string;
            member_count: number;
            subscription_price_ngn: number | null;
            entry_fee_ngn: number | null;
            drop_ends_at: string | null;
            cover_emoji: string;
            spectacle_threshold_coins?: number | null;
          };
          isMember: boolean;
          isCreator: boolean;
        };
        const r = data.room;
        setRoom({
          id: r.id,
          name: r.name,
          description: r.description ?? "",
          type: r.type as RoomType,
          creatorId: r.creator_id,
          creatorUsername: r.creator_username,
          creatorAvatarEmoji: r.creator_avatar_emoji,
          memberCount: r.member_count,
          isSubscribed: data.isMember,
          entryFeePaid: data.isMember,
          subscriptionPrice: r.subscription_price_ngn ?? 0,
          entryFee: r.entry_fee_ngn ?? 0,
          dropExpiresAt: r.drop_ends_at,
          coverEmoji: r.cover_emoji,
          minGiftSpectacleCoin: r.spectacle_threshold_coins ?? undefined,
        });
      } catch (e) {
        const err = e as Error & { code?: string | null };
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Error loading room") : "Error loading room");
      } finally {
        setLoadingRoom(false);
      }
    })();
  }, [roomId, router]);

  // Auto-join free_open and tipping rooms on first visit.
  // These room types have no payment gate — clicking in IS the join action.
  // Without this, the user sees the chat UI but gets 403 on every POST /messages
  // because they're not yet in room_members.
  // A 409 means the server already has an active membership record — treat it
  // as success so messaging and realtime are never blocked by the race condition.
  const joinAttemptedRef = useRef(false);
  useEffect(() => {
    if (!room || !currentUserId) return;
    if (joinAttemptedRef.current) return;
    if (room.creatorId === currentUserId) return;
    if (room.isSubscribed) return;
    if (room.type !== "free_open" && room.type !== "tipping") return;

    joinAttemptedRef.current = true;
    fetch(`/api/rooms/${roomId}/join`, { method: "POST", credentials: "include" })
      .then((res) => {
        if (res.ok || res.status === 409) {
          setRoom((r) => r ? { ...r, isSubscribed: true } : r);
        }
      })
      .catch(() => {});
  }, [room, currentUserId, roomId]);

  // Shared incoming-message handler — used by the initial load, the baseline
  // poll, the sender's own optimistic echo, and the realtime hook. Dedupes by
  // id and keeps the feed in chronological order, so the same message arriving
  // from two channels (poll + realtime) never double-renders.
  const handleIncomingMessage = useCallback((msg: Message) => {
    if (!msg || !msg.id) return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      next.sort(sortByCreatedAtAsc);
      lastMessageIdRef.current = next[next.length - 1]?.id;
      latestCreatedAtRef.current = next[next.length - 1]?.createdAt;
      return next;
    });
    if (
      initializedRef.current &&
      !seenMessageIdsRef.current.has(msg.id) &&
      msg.giftEmoji &&
      typeof msg.giftAmount === "number"
    ) {
      const threshold = minGiftSpectacleCoinRef.current ?? 50;
      if (msg.giftAmount >= threshold) {
        setSpectacle({
          senderUsername: msg.username,
          senderAvatarEmoji: msg.avatarEmoji,
          giftName: "Gift",
          giftEmoji: msg.giftEmoji,
          coinValue: msg.giftAmount,
        });
        if (spectacleTimerRef.current) clearTimeout(spectacleTimerRef.current);
        spectacleTimerRef.current = setTimeout(() => setSpectacle(null), 3_000);
      }
    }
    seenMessageIdsRef.current.add(msg.id);
  }, []);

  // Fetch the latest message snapshot (newest 30) and merge it in. Used for the
  // initial load and for the baseline poll. The REST endpoint returns
  // newest-first, so we re-sort ascending before merging.
  const fetchMessages = useCallback(async () => {
    try {
      // After the first load, request only messages newer than the latest one
      // we have (delta fetch) — far cheaper than re-pulling the whole snapshot.
      const after = latestCreatedAtRef.current;
      const url = after
        ? `/api/rooms/${roomId}/messages?after=${encodeURIComponent(after)}`
        : `/api/rooms/${roomId}/messages`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: Message[] };
      const items = (data.items ?? []).slice().sort(sortByCreatedAtAsc);
      for (const m of items) handleIncomingMessage(m);
      // Backlog seeded — from here on, gift messages may trigger the spectacle.
      initializedRef.current = true;
    } catch { /* non-fatal — next poll retries */ } finally {
      setLoadingMessages(false);
    }
  }, [roomId, handleIncomingMessage]);

  // Live presence + soft-cap admission. Heartbeat on mount and every 45s while
  // viewing; Redis frees the slot automatically on close/idle. When the room is
  // full and we are not admitted, we stop subscribing/polling so a full room
  // never adds to realtime fan-out — that is the whole point of the cap.
  const [presence, setPresence] = useState<{
    admitted: boolean;
    presentCount: number;
    cap: number;
  } | null>(null);
  useEffect(() => {
    if (!roomId || !room) return;
    let cancelled = false;
    const beat = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/presence`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const d = (await res.json()) as { admitted: boolean; presentCount: number; cap: number };
        if (!cancelled) setPresence(d);
      } catch { /* non-fatal — Redis fails open server-side */ }
    };
    void beat();
    const id = setInterval(() => void beat(), 45_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [roomId, room]);

  const presenceAdmitted = presence?.admitted ?? true;
  const roomFull = presence ? !presence.admitted : false;

  // Push-based realtime subscription (no-op when no provider is configured,
  // when the room is full and we were not admitted, or when membership is not
  // yet confirmed — attempting a token before joining produces a 403).
  const onRealtimeEvent = useCallback((event: string, data: unknown) => {
    if (event === "new_message") handleIncomingMessage(data as Message);
  }, [handleIncomingMessage]);

  const isMember = room?.isSubscribed ?? false;
  const realtimeConnected = useRealtimeChannel(
    REALTIME_PROVIDER && presenceAdmitted && isMember ? `room:${roomId}:messages` : null,
    onRealtimeEvent
  );

  // Baseline poll — fast (3s) when the realtime socket is down or no provider
  // is configured; slow reconcile (30s) when it is connected; paused while the
  // tab is hidden. Disabled when the room is full (not admitted). Dedup in
  // handleIncomingMessage makes the overlapping realtime + poll paths safe.
  useAdaptiveChatPoll({ poll: fetchMessages, connected: realtimeConnected, enabled: presenceAdmitted });

  // Clear the spectacle timer on unmount.
  useEffect(() => {
    return () => {
      if (spectacleTimerRef.current) clearTimeout(spectacleTimerRef.current);
    };
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    const momentFlag = isMoment;
    const content = input.trim();
    setInput("");
    if (momentFlag) setIsMoment(false);
    try {
      const body: Record<string, unknown> = { content };
      if (momentFlag) body.message_type = "moment";
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to send");
      const data = (await res.json()) as { message?: Message };
      if (data.message) handleIncomingMessage(data.message);
    } catch { /* ignore */ }
    setSending(false);
  }

  // Fetch Drop Room replay (for drop rooms only)
  useEffect(() => {
    if (!room || room.type !== "drop") { setReplay(null); return; }
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/replay`, { credentials: "include" });
        if (res.status === 404) { setReplay(null); return; }
        if (!res.ok) { setReplay(null); return; }
        const body = (await res.json()) as {
          replay?: DropReplay;
          data?: { replay?: DropReplay } & DropReplay;
          userHasAccess?: boolean;
        };
        const replayObj =
          (body.data as { replay?: DropReplay } | undefined)?.replay ??
          (body as { replay?: DropReplay }).replay ??
          null;
        setReplay(replayObj);
        if (body.userHasAccess) setReplayPurchased(true);
      } catch { setReplay(null); }
    })();
  }, [room, roomId]);

  async function handlePublishReplay() {
    if (!replayTitle.trim()) return;
    setPublishingReplay(true);
    try {
      // Use last 20 messages as highlights
      const highlights = messages.slice(-20).map((m) => ({
        content: m.content,
        sender: m.username,
        timestamp: m.createdAt,
      }));
      const res = await fetch(`/api/rooms/${roomId}/replay`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: replayTitle.trim(), highlights, replay_fee_kobo: replayFeeCoins * 100 }),
      });
      if (!res.ok) throw new Error("Failed to publish replay");
      const data = (await res.json()) as { replay?: DropReplay; data?: DropReplay };
      setReplay(data.replay ?? data.data ?? null);
      setShowPublishForm(false);
    } catch { /* ignore */ }
    setPublishingReplay(false);
  }

  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  async function handleSubscribe() {
    setSubscribing(true);
    setSubscribeError(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: "balance" }),
      });
      if (res.ok) {
        setRoom((r) => r ? { ...r, isSubscribed: true } : r);
      } else {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string }; message?: string };
        const msg = body.error?.message ?? body.message ?? "Subscription failed. Please try again.";
        const code = body.error?.code ?? null;
        setSubscribeError(translateApiError(tRef.current, code, msg));
      }
    } catch {
      setSubscribeError("Network error. Please try again.");
    }
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
    room.type === "free_open" ||
    room.type === "tipping" ||
    room.type === "guild" ||
    room.type === "classroom" ||
    (room.type === "vip" && room.isSubscribed) ||
    (room.type === "drop" && room.entryFeePaid);

  const previewMessages = messages.slice(-3);

  if (loadingRoom) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-neutral-500">{error ?? "Room not found"}</p>
        <Link href="/rooms" className="text-sm text-blue-600 hover:underline">← Back to Rooms</Link>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden lg:flex-row">
      {/* Main content. `min-h-0` is essential: without it this flex column
          keeps its default `min-height:auto`, refuses to shrink below its
          content height, and overflows the bounded parent — which clips the
          feed (ancestor has overflow-hidden) so the inner `overflow-y-auto`
          never gets a constrained height and the chat cannot scroll. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Room header */}
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-2xl">{room.coverEmoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold text-neutral-900 dark:text-neutral-50">{room.name}</h1>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold capitalize text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {(room.type ?? "").replace("_", " ")}
              </span>
            </div>
            <p className="truncate text-xs text-neutral-500">{(room.memberCount ?? 0).toLocaleString()} members</p>
            <LiveRoomPulseBar roomId={room.id} initialActiveCount={presence?.presentCount ?? 0} initialMaxCapacity={presence?.cap ?? (room.memberCount || 30)} className="mt-1" />
          </div>
          {/* Top gifter display — PRD §12 */}
          {topGifter && (
            <div className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 dark:bg-amber-950/40" title={`Top gifter: @${topGifter.username}`}>
              <span className="text-sm">👑</span>
              <span className="max-w-[80px] truncate text-xs font-semibold text-amber-700 dark:text-amber-300">
                @{topGifter.username}
              </span>
            </div>
          )}
          <Link href="/rooms" className="text-xs text-blue-600 hover:underline dark:text-blue-400">← Rooms</Link>
        </div>

        {/* Room full (soft cap) banner */}
        {roomFull && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              {t("room.full")}
            </p>
          </div>
        )}

        {/* Tipping room banner */}
        {room.type === "tipping" && (
          <div className="border-b border-blue-200 bg-blue-50 px-4 py-2.5 text-center dark:border-blue-800 dark:bg-blue-950/30">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">🎤 Tipping Room — show your support with gifts!</p>
          </div>
        )}

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
            subscribeError={subscribeError}
          />
        ) : (
          <>
            <div
              ref={feedRef}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
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

            {/* Rich input bar — text, GIF, stickers, gifts, Room Powers */}
            <RoomInputBar
              roomId={roomId}
              input={input}
              setInput={setInput}
              sending={sending}
              canAccess={canAccess && presenceAdmitted}
              currentUserId={currentUserId}
              lastOwnMessageId={
                messages.filter((m) => m.userId === currentUserId).at(-1)?.id ?? null
              }
              isMoment={isMoment}
              onMomentToggle={() => setIsMoment((v) => !v)}
              onSend={handleSend}
              onMessageSent={(msg) =>
                setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
              }
            />
          </>
        )}
      </div>

      {/* Gift spectacle overlay — dims feed and shows animation for 3s (PRD §12) */}
      {spectacle && (
        <button
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setSpectacle(null)}
          aria-label="Dismiss gift spectacle"
          type="button"
        >
          <div className="mx-6 flex flex-col items-center gap-3 rounded-2xl border-2 border-amber-400 bg-white p-8 text-center shadow-2xl dark:bg-neutral-900">
            <span className="text-7xl leading-none">{spectacle.giftEmoji}</span>
            <p className="text-xl font-extrabold text-neutral-900 dark:text-neutral-50">{spectacle.giftName}</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{spectacle.senderAvatarEmoji}</span>
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                <span className="font-bold text-neutral-900 dark:text-neutral-50">@{spectacle.senderUsername}</span>{" "}sent this gift!
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-4 py-2 dark:bg-amber-950/30">
              <span className="text-lg">🪙</span>
              <span className="text-lg font-extrabold text-amber-700 dark:text-amber-300">
                {spectacle.coinValue.toLocaleString()} {currency.softPlural.toLowerCase()}
              </span>
            </div>
            <p className="text-xs text-neutral-400">Tap to dismiss</p>
          </div>
        </button>
      )}

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

        {/* Creator Gift Spectacle Threshold (PRD §12) — visible to room creator only */}
        {currentUserId && room.creatorId === currentUserId && (
          <SpectacleThresholdPanel roomId={roomId} initialThreshold={room.minGiftSpectacleCoin ?? null} />
        )}

        {/* Room capacity upgrade (paid) — visible to room creator only */}
        {currentUserId && room.creatorId === currentUserId && (
          <RoomCapacityPanel roomId={roomId} />
        )}

        {/* ClassRoom Curriculum (PRD §10) */}
        {room.type === "classroom" && (
          <ClassRoomCurriculum roomId={roomId} isCreator={room.creatorId === currentUserId} />
        )}

        {/* Drop Room Replay (PRD §10) */}
        {room.type === "drop" && replay !== "loading" && (
          <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">📼 Drop Replay</h2>
            {replay && replay.isPublished ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{replay.title}</p>
                {(replay.replayFeeKobo ?? 0) > 0 && !replayPurchased && room.creatorId !== currentUserId ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                    <p className="mb-2 text-xs text-amber-800 dark:text-amber-300">
                      🔒 Replay requires a one-time fee of{" "}
                      <strong>{((replay.replayFeeKobo ?? 0) / 100).toLocaleString()} {currency.softPlural?.toLowerCase()}</strong>
                    </p>
                    <button
                      type="button"
                      disabled={purchasingReplay}
                      onClick={async () => {
                        setPurchasingReplay(true);
                        try {
                          const res = await fetch(`/api/rooms/${roomId}/replay/purchase`, {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                          });
                          if (res.ok) setReplayPurchased(true);
                        } catch { /* ignore */ } finally { setPurchasingReplay(false); }
                      }}
                      className="w-full rounded-lg bg-amber-500 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                    >
                      {purchasingReplay ? "Processing…" : `🪙 Unlock Replay · ${(replay.replayFeeKobo / 100).toLocaleString()} ${currency.softPlural.toLowerCase()}`}
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-neutral-500">{replay.highlights.length} highlights</p>
                    {replay.replayFeeKobo > 0 && (
                      <p className="text-xs font-semibold text-teal-600 dark:text-teal-400">✓ Replay unlocked</p>
                    )}
                    <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto rounded-lg bg-neutral-50 p-2 text-xs dark:bg-neutral-800">
                      {replay.highlights.map((h, i) => (
                        <div key={i} className="text-neutral-600 dark:text-neutral-300">
                          <span className="font-semibold">{h.sender}:</span> {h.content}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : room.creatorId === currentUserId ? (
              showPublishForm ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={replayTitle}
                    onChange={(e) => setReplayTitle(e.target.value)}
                    placeholder="Replay title"
                    maxLength={100}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  {/* Replay fee — PRD §10: "published for a smaller replay fee" */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                      Replay fee ({currency.softPlural.toLowerCase()}):
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={replayFeeCoins}
                      onChange={(e) => setReplayFeeCoins(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="0 = free"
                      className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                  </div>
                  <p className="text-xs text-neutral-400">Last 20 messages will be published as highlights.</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPublishForm(false)}
                      className="flex-1 rounded-lg border border-neutral-300 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700"
                    >Cancel</button>
                    <button
                      type="button"
                      onClick={handlePublishReplay}
                      disabled={publishingReplay || !replayTitle.trim()}
                      className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >{publishingReplay ? "Publishing…" : "Publish"}</button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-xs text-neutral-500">No replay published yet.</p>
                  <button
                    type="button"
                    onClick={() => setShowPublishForm(true)}
                    className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    📼 Publish Replay
                  </button>
                </div>
              )
            ) : (
              <p className="text-xs text-neutral-400">No replay available for this drop.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
