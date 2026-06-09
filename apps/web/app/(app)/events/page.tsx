"use client";

/**
 * app/(app)/events/page.tsx
 *
 * Events / Cultural Calendar page.
 * - Fetches active and upcoming platform events from /api/events
 * - Active events: LIVE badge
 * - Flash XP events: countdown timer
 * - Gift drop: purchase flow
 * - Upcoming events: relative time
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType = "flash_xp" | "guild_war" | "cultural" | "mystery_drop" | string;

interface PlatformEvent {
  id: string;
  title: string;
  description: string;
  type: EventType;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  xpMultiplier?: number;
  rewardDescription?: string;
}

interface GiftDrop {
  id: string;
  name: string;
  description: string;
  coinCost: number;
  endsAt: string;
  owned: boolean;
  itemId?: string;
}

interface EventsData {
  events: PlatformEvent[];
  giftDrop: GiftDrop | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventTypeLabel(type: EventType): string {
  const map: Record<string, string> = {
    flash_xp: "Flash XP",
    guild_war: "Guild War",
    cultural: "Cultural",
    mystery_drop: "Mystery Drop",
  };
  return map[type] ?? type.replace(/_/g, " ");
}

function eventTypeColor(type: EventType): string {
  const map: Record<string, string> = {
    flash_xp: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    guild_war: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    cultural: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
    mystery_drop: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  };
  return map[type] ?? "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
}

function formatCountdown(endsAt: string): string {
  const diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function relativeStartTime(startsAt: string): string {
  const diff = new Date(startsAt).getTime() - Date.now();
  if (diff <= 0) return "Starting soon";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `Starts in ${min} minute${min !== 1 ? "s" : ""}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Starts in ${hr} hour${hr !== 1 ? "s" : ""}`;
  const days = Math.floor(hr / 24);
  return `Starts in ${days} day${days !== 1 ? "s" : ""}`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start justify-between">
            <div className="space-y-2 flex-1">
              <SkeletonBlock className="h-5 w-48" />
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-2/3" />
            </div>
            <SkeletonBlock className="h-6 w-16 ml-3 shrink-0 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown hook
// ---------------------------------------------------------------------------

function useCountdown(endsAt: string | null): string {
  const [display, setDisplay] = useState(endsAt ? formatCountdown(endsAt) : "");

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setDisplay(formatCountdown(endsAt)), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return display;
}

// ---------------------------------------------------------------------------
// Gift Drop Card
// ---------------------------------------------------------------------------

interface GiftDropCardProps {
  drop: GiftDrop;
  onPurchase: () => Promise<void>;
  purchasing: boolean;
}

function GiftDropCard({ drop, onPurchase, purchasing }: GiftDropCardProps) {
  const countdown = useCountdown(drop.endsAt);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-card dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🎁</span>
            <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-300">Monthly Gift Drop</h2>
          </div>
          <p className="mt-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">{drop.name}</p>
          <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{drop.description}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">Ends in</p>
          <p className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">{countdown}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          {drop.coinCost.toLocaleString()} 🪙
        </span>
        {drop.owned ? (
          <span className="rounded-full bg-teal-100 px-3 py-1 text-sm font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
            Owned ✓
          </span>
        ) : (
          <button
            onClick={onPurchase}
            disabled={purchasing}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {purchasing ? "Processing…" : "Buy Now"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Card
// ---------------------------------------------------------------------------

function EventCard({ event }: { event: PlatformEvent }) {
  const countdown = useCountdown(event.isActive ? event.endsAt : null);

  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-card dark:bg-neutral-900 ${
        event.isActive ? "border-blue-300 dark:border-blue-700" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${eventTypeColor(event.type)}`}>
              {eventTypeLabel(event.type)}
            </span>
            {event.isActive && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900 dark:text-red-300">
                LIVE
              </span>
            )}
          </div>
          <h3 className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-50">{event.title}</h3>
          <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{event.description}</p>
          {event.xpMultiplier && event.xpMultiplier > 1 && (
            <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              {event.xpMultiplier}× XP multiplier
            </p>
          )}
          {event.rewardDescription && (
            <p className="mt-1 text-xs text-neutral-500">{event.rewardDescription}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          {event.isActive && event.type === "flash_xp" && countdown && (
            <div>
              <p className="text-xs font-semibold text-neutral-500">Ends in</p>
              <p className="font-bold tabular-nums text-red-600 dark:text-red-400">{countdown}</p>
            </div>
          )}
          {event.isActive && event.type !== "flash_xp" && (
            <div>
              <p className="text-xs text-neutral-500">
                Ends {new Date(event.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </p>
            </div>
          )}
          {!event.isActive && (
            <div>
              <p className="text-xs font-semibold text-neutral-500">{relativeStartTime(event.startsAt)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function EventsPage() {
  const [data, setData] = useState<EventsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasingDrop, setPurchasingDrop] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  const loadData = useCallback(async () => {
    try {
      const [eventsRes, giftRes] = await Promise.all([
        fetch("/api/events", { credentials: "include" }),
        fetch("/api/events/gift-drop", { credentials: "include" }).catch(() => null),
      ]);

      if (eventsRes.status === 401) { window.location.href = "/auth/login"; return; }
      if (!eventsRes.ok) throw new Error("Failed to load events");

      const eventsJson = (await eventsRes.json()) as
        | PlatformEvent[]
        | { events?: PlatformEvent[] };
      const events: PlatformEvent[] = Array.isArray(eventsJson)
        ? eventsJson
        : (eventsJson as { events?: PlatformEvent[] }).events ?? [];

      let giftDrop: GiftDrop | null = null;
      if (giftRes?.ok) {
        const giftJson = (await giftRes.json()) as GiftDrop | { data?: GiftDrop } | null;
        giftDrop =
          giftJson && (giftJson as { data?: GiftDrop }).data !== undefined
            ? ((giftJson as { data?: GiftDrop }).data ?? null)
            : (giftJson as GiftDrop | null);
      }

      setData({ events, giftDrop });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function handlePurchaseDrop() {
    if (!data?.giftDrop) return;
    setPurchasingDrop(true);
    try {
      const res = await fetch("/api/economy/gifts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: data.giftDrop.itemId ?? data.giftDrop.id, source: "gift_drop" }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string; error?: string };
        throw new Error(d.message ?? d.error ?? "Purchase failed");
      }
      setData((prev) =>
        prev && prev.giftDrop ? { ...prev, giftDrop: { ...prev.giftDrop, owned: true } } : prev
      );
      showToast("Gift drop purchased!");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setPurchasingDrop(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <h1 className="mb-5 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Events</h1>
        <PageSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  const activeEvents = (data?.events ?? []).filter((e) => e.isActive);
  const upcomingEvents = (data?.events ?? []).filter((e) => !e.isActive);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Events</h1>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-modal">
          {toast}
        </div>
      )}

      {/* Monthly Gift Drop */}
      {data?.giftDrop && (
        <GiftDropCard
          drop={data.giftDrop}
          onPurchase={handlePurchaseDrop}
          purchasing={purchasingDrop}
        />
      )}

      {/* Active events */}
      {activeEvents.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Active Now</h2>
          <div className="space-y-3">
            {activeEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming events */}
      {upcomingEvents.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Upcoming</h2>
          <div className="space-y-3">
            {upcomingEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}

      {activeEvents.length === 0 && upcomingEvents.length === 0 && !data?.giftDrop && (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">📅</span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">No events right now</h2>
          <p className="mt-1 text-sm text-neutral-500">Check back soon for upcoming events and drops!</p>
        </div>
      )}
    </div>
  );
}
