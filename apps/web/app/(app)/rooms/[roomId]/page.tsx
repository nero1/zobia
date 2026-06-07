"use client";

/**
 * app/(app)/rooms/[roomId]/page.tsx
 *
 * Room detail page (web version).
 * Two-column layout: main message feed + sidebar (room info, creator, top gifters).
 * Supports VIP subscribe overlay and Drop entry fee notices.
 * Uses SSE stream (/api/rooms/[roomId]/stream) for real-time message updates.
 * Reconnects automatically after 3 seconds on error or close.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TopGifters } from "@/components/rooms/TopGifters";
import { LiveRoomPulseBar } from "@/components/ui/LiveRoomPulseBar";

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
  avatarEmoji: string;
  content: string;
  createdAt: string;
  giftEmoji?: string;
  giftAmount?: number;
  message_type?: "text" | "moment" | "gif" | "sticker";
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
      {data.modules.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {data.modules.slice().sort((a, b) => a.order - b.order).map((mod) => (
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
          {enrolling ? "Enrolling…" : data.enrolmentFee > 0 ? `Enrol · ${data.enrolmentFee.toLocaleString()} coins` : "Enrol (Free)"}
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
        <div className={`mt-0.5 rounded-2xl px-3.5 py-2 text-sm ${
          msg.message_type === "moment"
            ? "border-2 border-purple-400 bg-purple-50 text-purple-900 dark:border-purple-600 dark:bg-purple-950/50 dark:text-purple-100"
            : isOwn
              ? "rounded-tr-sm bg-blue-600 text-white"
              : "rounded-tl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
        }`}>
          {msg.giftEmoji && (
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold opacity-80">
              <span>{msg.giftEmoji}</span>
              <span>Gift · {msg.giftAmount} coins</span>
            </div>
          )}
          {msg.content}
          {msg.message_type === "moment" && (
            <div className="mt-1 text-xs font-semibold text-purple-500 dark:text-purple-400">⚡ Moment · 24h</div>
          )}
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
    <div className="absolute bottom-full left-0 z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
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
        const data = (await res.json()) as { packs?: StickerPackRoom[] };
        const unlocked = (data.packs ?? []).filter((p) => p.isUnlocked);
        setPacks(unlocked);
        if (unlocked.length > 0) setActivePack(unlocked[0].id);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  const currentPack = packs.find((p) => p.id === activePack);
  return (
    <div className="absolute bottom-full left-10 z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
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
}: { roomId: string; onClose: () => void }) {
  const [activating, setActivating] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const POWERS = [
    { type: "message_pin",      emoji: "📌", label: "Pin Message",       description: "Pin your last message at the top for 1 hour", coins: 100 },
    { type: "room_spotlight",   emoji: "🔦", label: "Room Spotlight",    description: "Feature this room in discovery for 6 hours",  coins: 500 },
    { type: "member_highlight", emoji: "⭐", label: "Member Highlight",  description: "Highlight yourself in the room for 1 hour",    coins: 200 },
  ];

  async function activate(powerType: string) {
    setActivating(powerType);
    setResult(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/powers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ powerType }),
      });
      const d = (await res.json()) as { message?: string };
      setResult(res.ok ? "✅ Power activated!" : `❌ ${d.message ?? "Failed"}`);
    } catch { setResult("❌ Network error"); }
    setActivating(null);
  }

  return (
    <div className="absolute bottom-full right-0 z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
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
              🪙 {power.coins}
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
  isMoment,
  onMomentToggle,
  onSend,
}: RoomInputBarProps) {
  const [showGif, setShowGif] = useState(false);
  const [showSticker, setShowSticker] = useState(false);
  const [showPowers, setShowPowers] = useState(false);
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
    } catch { /* ignore */ }
    setShowGif(false);
    setShowSticker(false);
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
        <RoomPowersPanel roomId={roomId} onClose={() => setShowPowers(false)} />
      )}

      {/* Moment mode indicator */}
      {isMoment && (
        <div className="flex items-center gap-1.5 border-b border-purple-200 bg-purple-50 px-3 py-1.5 dark:border-purple-900 dark:bg-purple-950/40">
          <span className="text-sm">⚡</span>
          <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">Moment · disappears in 24h</span>
          <button type="button" onClick={onMomentToggle} className="ml-auto text-xs text-purple-500 hover:text-purple-700 dark:hover:text-purple-300">Cancel</button>
        </div>
      )}

      <form onSubmit={onSend} className="flex items-center gap-1.5 p-3">
        {/* GIF */}
        <button type="button" onClick={() => toggle("gif")}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold transition-colors ${showGif ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          aria-label="GIF" title="GIF" disabled={!canAccess}>
          GIF
        </button>

        {/* Sticker */}
        <button type="button" onClick={() => toggle("sticker")}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${showSticker ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
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
          className={`flex-1 rounded-xl border bg-neutral-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-1 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-100 ${
            isMoment
              ? "border-purple-400 focus:border-purple-500 focus:ring-purple-500 dark:border-purple-600"
              : "border-neutral-300 focus:border-blue-500 focus:ring-blue-500 dark:border-neutral-700"
          }`}
        />

        {/* Moment toggle */}
        <button type="button" onClick={onMomentToggle} title="Moment (24h)" aria-label="Toggle Moment mode" disabled={!canAccess}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${isMoment ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
          🌟
        </button>

        {/* Gift */}
        <Link href={`/rooms/${roomId}/gift`}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-neutral-400 hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-900/30"
          title="Send a gift" aria-label="Send a gift">
          🎁
        </Link>

        {/* Room Powers */}
        <button type="button" onClick={() => toggle("powers")}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors ${showPowers ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          aria-label="Room Powers" title="Room Powers" disabled={!canAccess}>
          ⚡
        </button>

        {/* Send */}
        <button type="submit" disabled={!input.trim() || sending || !canAccess}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
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
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error saving");
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
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const lastMessageIdRef = useRef<string | undefined>(undefined);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  // Poll top gifters every 30 seconds
  useEffect(() => {
    let cancelled = false;
    const fetchTopGifters = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/gifts`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { gifters?: TopGifterRow[] };
        if (!cancelled && data.gifters && data.gifters.length > 0) {
          setTopGifter(data.gifters[0]);
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

  // Fetch initial messages (before SSE connects)
  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}/messages`, { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { messages: Message[] };
    setMessages(data.messages);
    if (data.messages.length > 0) {
      lastMessageIdRef.current = data.messages[data.messages.length - 1].id;
    }
    setLoadingMessages(false);
  }, [roomId]);

  // Connect to SSE stream
  const connectSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }
    const url = lastMessageIdRef.current
      ? `/api/rooms/${roomId}/stream?lastMessageId=${lastMessageIdRef.current}`
      : `/api/rooms/${roomId}/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as { type: string; payload?: Message };
        if (parsed.type === "message" && parsed.payload) {
          const newMsg = parsed.payload;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            lastMessageIdRef.current = newMsg.id;
            return [...prev, newMsg];
          });
          // Trigger gift spectacle for high-value gifts (PRD §12)
          if (
            !seenMessageIdsRef.current.has(newMsg.id) &&
            newMsg.giftEmoji &&
            typeof newMsg.giftAmount === "number"
          ) {
            const threshold = room?.minGiftSpectacleCoin ?? 50;
            if (newMsg.giftAmount >= threshold) {
              setSpectacle({
                senderUsername: newMsg.username,
                senderAvatarEmoji: newMsg.avatarEmoji,
                giftName: "Gift",
                giftEmoji: newMsg.giftEmoji,
                coinValue: newMsg.giftAmount,
              });
              if (spectacleTimerRef.current) clearTimeout(spectacleTimerRef.current);
              spectacleTimerRef.current = setTimeout(() => setSpectacle(null), 3_000);
            }
          }
          seenMessageIdsRef.current.add(newMsg.id);
        }
        // type === "ping": do nothing
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // Reconnect after 3 seconds
      reconnectRef.current = setTimeout(() => {
        connectSSE();
      }, 3000);
    };
  }, [roomId]);

  useEffect(() => {
    void fetchMessages().then(() => {
      connectSSE();
    });
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      if (spectacleTimerRef.current) {
        clearTimeout(spectacleTimerRef.current);
      }
    };
  }, [fetchMessages, connectSSE]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    const momentFlag = isMoment;
    try {
      const body: Record<string, unknown> = { content: input.trim() };
      if (momentFlag) body.message_type = "moment";
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to send");
      setInput("");
      if (momentFlag) setIsMoment(false);
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
    room.type === "free_open" ||
    room.type === "tipping" ||
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
    <div className="relative flex h-screen flex-col overflow-hidden lg:flex-row">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Room header */}
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-2xl">{room.coverEmoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold text-neutral-900 dark:text-neutral-50">{room.name}</h1>
              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold capitalize text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {room.type.replace("_", " ")}
              </span>
            </div>
            <p className="truncate text-xs text-neutral-500">{room.memberCount.toLocaleString()} members</p>
            <LiveRoomPulseBar roomId={room.id} initialActiveCount={0} initialMaxCapacity={room.memberCount || 10000} className="mt-1" />
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

            {/* Rich input bar — text, GIF, stickers, gifts, Room Powers */}
            <RoomInputBar
              roomId={roomId}
              input={input}
              setInput={setInput}
              sending={sending}
              canAccess={canAccess}
              currentUserId={currentUserId}
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
                {spectacle.coinValue.toLocaleString()} coins
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
                {replay.replayFeeKobo > 0 && !replayPurchased && room.creatorId !== currentUserId ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                    <p className="mb-2 text-xs text-amber-800 dark:text-amber-300">
                      🔒 Replay requires a one-time fee of{" "}
                      <strong>{(replay.replayFeeKobo / 100).toLocaleString()} coins</strong>
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
                      {purchasingReplay ? "Processing…" : `🪙 Unlock Replay · ${(replay.replayFeeKobo / 100).toLocaleString()} coins`}
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
                      Replay fee (coins):
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
