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
import { RoomCard, type RoomCardData } from "@/components/rooms/RoomCard";

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
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRooms = useCallback(
    async (opts: { tab: Tab; type: RoomTypeFilter; q: string; cursor?: string; append?: boolean }) => {
      const { tab, type, q, cursor: cur, append } = opts;
      if (!append) setLoading(true);
      else setLoadingMore(true);

      try {
        const params = new URLSearchParams({ tab, type });
        if (q.trim()) params.set("q", q.trim());
        if (cur) params.set("cursor", cur);

        const res = await fetch(`/api/rooms?${params.toString()}`, { credentials: "include" });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (!res.ok) throw new Error("Failed to load rooms");
        const data = (await res.json()) as { rooms: RoomCardData[]; cursor?: string | null; hasMore?: boolean };

        setRooms((prev) => append ? [...prev, ...(data.rooms ?? [])] : (data.rooms ?? []));
        setCursor(data.cursor ?? null);
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
