"use client";

/**
 * app/(app)/rooms/page.tsx
 *
 * Rooms discovery page (web version).
 * Tab filters (Trending / Near Me / Friends In), room type chips,
 * search bar, RoomCard grid, cursor-based pagination, Create Room button.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RoomCard, type RoomCardData } from "@/components/rooms/RoomCard";
import { useCurrency } from "@/lib/hooks/useCurrency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "trending" | "nearby" | "friends";
type RoomTypeFilter = "all" | "public" | "vip" | "drop" | "classroom" | "guild";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: { key: Tab; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "nearby", label: "Near Me" },
  { key: "friends", label: "Friends In" },
];

const TYPE_CHIPS: { key: RoomTypeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "public", label: "Free" },
  { key: "vip", label: "VIP" },
  { key: "drop", label: "Drop" },
  { key: "classroom", label: "ClassRoom" },
  { key: "guild", label: "Guild" },
];

// ---------------------------------------------------------------------------
// Pinned rooms strip
// ---------------------------------------------------------------------------

function PinnedRoomsStrip({ rooms, onJoin }: { rooms: RoomCardData[]; onJoin: (id: string) => void }) {
  if (rooms.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">📌 Pinned</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {rooms.map((room) => (
          <button
            key={room.id}
            onClick={() => onJoin(room.id)}
            className="flex min-w-[88px] flex-shrink-0 flex-col items-center rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-center transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-blue-500 dark:hover:bg-blue-950"
          >
            <span className="text-2xl">{(room as { coverEmoji?: string }).coverEmoji ?? "🏠"}</span>
            <span className="mt-1 line-clamp-1 text-xs font-semibold text-neutral-800 dark:text-neutral-100">{room.name}</span>
            <span className="text-[10px] text-neutral-400">{room.memberCount ?? 0} members</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drop Room FOMO strip (PRD §2.1 — "Limited Rooms open for brief windows")
// ---------------------------------------------------------------------------

interface DropRoomFomo {
  id: string;
  name: string;
  coverEmoji: string;
  dropEndsAt: string;
  entryFee: number | null;
  memberCount: number;
}

function useCountdown(isoTarget: string): string {
  const [secs, setSecs] = useState(() => Math.max(0, Math.floor((new Date(isoTarget).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.max(0, Math.floor((new Date(isoTarget).getTime() - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [isoTarget]);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function DropRoomCard({ room }: { room: DropRoomFomo }) {
  const countdown = useCountdown(room.dropEndsAt);
  const urgentSecs = Math.max(0, Math.floor((new Date(room.dropEndsAt).getTime() - Date.now()) / 1000));
  const isUrgent = urgentSecs < 3600; // under 1 hour
  const currency = useCurrency();

  return (
    <Link
      href={`/rooms/${room.id}`}
      className={`flex min-w-[200px] shrink-0 flex-col rounded-xl border p-4 transition-colors hover:shadow-md ${isUrgent ? "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/20" : "border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/20"}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-3xl">{room.coverEmoji}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${isUrgent ? "bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200" : "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300"}`}>
          ⏱ {countdown}
        </span>
      </div>
      <p className="line-clamp-1 text-sm font-bold text-neutral-900 dark:text-neutral-50">{room.name}</p>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-neutral-500">
        <span>{room.memberCount} inside</span>
        {room.entryFee != null ? <span>· {room.entryFee.toLocaleString()} {currency.softPlural?.toLowerCase()} entry</span> : <span>· Free entry</span>}
      </div>
    </Link>
  );
}

function DropRoomFomoStrip() {
  const [dropRooms, setDropRooms] = useState<DropRoomFomo[]>([]);

  useEffect(() => {
    fetch("/api/rooms?type=drop&trending=1&limit=6", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { items?: Array<RoomCardData & { dropEndsAt?: string; entryFee?: number }> } | null) => {
        const drops = (d?.items ?? [])
          .filter((r) => r.type === "drop" && r.dropEndsAt)
          .map((r) => ({
            id: r.id,
            name: r.name,
            coverEmoji: r.coverEmoji ?? "🎟️",
            dropEndsAt: (r as { dropEndsAt?: string }).dropEndsAt!,
            entryFee: r.entryFee ?? null,
            memberCount: r.memberCount,
          }));
        setDropRooms(drops);
      })
      .catch(() => {});
  }, []);

  if (dropRooms.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
        🔥 Closing Soon — Don&apos;t Miss Out
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {dropRooms.map((r) => <DropRoomCard key={r.id} room={r} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton grid
// ---------------------------------------------------------------------------

function RoomsGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="aspect-video bg-neutral-200 dark:bg-neutral-700" />
          <div className="space-y-2 p-3">
            <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="mt-2 h-8 w-full rounded-lg bg-neutral-200 dark:bg-neutral-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Rooms discovery page with tab filters, type chips, search, and pagination.
 */
export default function RoomsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("trending");
  const [typeFilter, setTypeFilter] = useState<RoomTypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [rooms, setRooms] = useState<RoomCardData[]>([]);
  const [pinnedRooms, setPinnedRooms] = useState<RoomCardData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rooms/pinned", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { rooms: [] })
      .then((d: { rooms?: RoomCardData[] }) => setPinnedRooms(d.rooms ?? []))
      .catch(() => {});
  }, []);

  const fetchRooms = useCallback(
    async (opts: { tab: Tab; type: RoomTypeFilter; q: string; cursor?: string; append?: boolean }) => {
      const { tab, type, q, cursor: cur, append } = opts;
      if (!append) setLoading(true);
      else setLoadingMore(true);

      try {
        const params = new URLSearchParams();
        if (tab === "trending") params.set("trending", "1");
        if (tab === "friends") params.set("friends_in_room", "1");
        if (type === "public") params.set("type", "free_open");
        else if (type !== "all") params.set("type", type);
        if (q.trim()) params.set("q", q.trim());
        if (cur) params.set("cursor", cur);

        const res = await fetch(`/api/rooms?${params.toString()}`, { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (!res.ok) throw new Error("Failed to load rooms");
        const data = (await res.json()) as { items: RoomCardData[]; nextCursor?: string | null; hasMore?: boolean };

        setRooms((prev) => append ? [...prev, ...(data.items ?? [])] : (data.items ?? []));
        setCursor(data.nextCursor ?? null);
        setHasMore(data.hasMore ?? false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  // Initial + tab/type/search change
  useEffect(() => {
    setError(null);
    void fetchRooms({ tab: activeTab, type: typeFilter, q: searchQuery });
  }, [activeTab, typeFilter, searchQuery, fetchRooms]);

  function handleLoadMore() {
    if (!cursor || loadingMore) return;
    void fetchRooms({ tab: activeTab, type: typeFilter, q: searchQuery, cursor, append: true });
  }

  async function handleJoin(roomId: string) {
    setJoiningId(roomId);
    try {
      const res = await fetch(`/api/rooms/${roomId}/join`, { method: "POST", credentials: "include" });
      if (res.ok) {
        setRooms((prev) => prev.map((r) => r.id === roomId ? { ...r, isJoined: true } : r));
        router.push(`/rooms/${roomId}`);
      }
    } catch { /* ignore */ }
    setJoiningId(null);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Rooms</h1>
        <button
          onClick={() => router.push("/rooms/create")}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + Create Room
        </button>
      </div>

      {/* Pinned rooms */}
      <PinnedRoomsStrip rooms={pinnedRooms} onJoin={(id) => router.push(`/rooms/${id}`)} />

      {/* Drop Room FOMO strip — closing soon (PRD §2.1) */}
      <DropRoomFomoStrip />

      {/* Tab filters */}
      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setRooms([]); setCursor(null); }}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setRooms([]); setCursor(null); }}
          placeholder="Search rooms…"
          className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500"
        />
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-2">
        {TYPE_CHIPS.map((chip) => (
          <button
            key={chip.key}
            onClick={() => { setTypeFilter(chip.key); setRooms([]); setCursor(null); }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              typeFilter === chip.key
                ? "bg-blue-600 text-white"
                : "border border-neutral-300 text-neutral-600 hover:border-blue-400 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-400"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Room grid */}
      {loading ? (
        <RoomsGridSkeleton />
      ) : rooms.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-16 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-4xl">🏠</span>
          <p className="mt-3 text-base font-semibold text-neutral-700 dark:text-neutral-300">No rooms found</p>
          <p className="mt-1 text-sm text-neutral-400">
            {searchQuery.trim() ? "Try a different search term or filter" : "Be the first to create a room!"}
          </p>
          <button
            onClick={() => router.push("/rooms/create")}
            className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Create a Room
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                onJoin={handleJoin}
                joining={joiningId === room.id}
              />
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="rounded-xl border border-neutral-300 px-6 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
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
