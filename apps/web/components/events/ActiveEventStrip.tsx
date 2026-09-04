"use client";

/**
 * components/events/ActiveEventStrip.tsx
 *
 * Promotes the current/next platform event near the top of the app, and
 * pops a one-time "New Event" notice the first time a viewer sees an event
 * that just went live. Mounted once in app/(app)/layout.tsx so it covers
 * every authenticated page (home, rooms, leaderboards, etc.) — PRD request:
 * "random new and ongoing events should be promoted in the updates areas of
 * various pages (usually near the top)".
 *
 * Data comes from the existing public GET /api/events (no new endpoint, no
 * extra Redis calls). Seen/dismissed state lives entirely in localStorage,
 * scoped by event id — no server round-trip needed to remember it, and it
 * naturally resets if the browser storage is cleared.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawEvent {
  id: string;
  name?: string;
  description?: string | null;
  event_type?: string;
  xp_multiplier?: number;
  starts_at?: string;
  ends_at?: string;
  is_active?: boolean; // "is_active" here means "currently live" — see /api/events
}

interface PromoEvent {
  id: string;
  name: string;
  description: string | null;
  xpMultiplier: number;
  startsAt: string;
  endsAt: string;
  isLive: boolean;
}

const SEEN_KEY = "zobia:events:seenIds";
const DISMISSED_KEY = "zobia:events:dismissedIds";

function readIdSet(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, ids: Set<string>) {
  try {
    // Cap stored history so this never grows unbounded on a long-lived device.
    window.localStorage.setItem(key, JSON.stringify(Array.from(ids).slice(-200)));
  } catch {
    // Storage unavailable (private mode, quota) — the strip/popup just won't remember state.
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActiveEventStrip() {
  const [events, setEvents] = useState<PromoEvent[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [newEventPopup, setNewEventPopup] = useState<PromoEvent | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/events");
        if (!res.ok) return;
        const json = (await res.json()) as { data?: { events?: RawEvent[] } };
        const raw = json.data?.events ?? [];
        const mapped: PromoEvent[] = raw.map((e) => ({
          id: e.id,
          name: e.name ?? "Platform Event",
          description: e.description ?? null,
          xpMultiplier: e.xp_multiplier ?? 1,
          startsAt: e.starts_at ?? new Date().toISOString(),
          endsAt: e.ends_at ?? new Date().toISOString(),
          isLive: !!e.is_active,
        }));
        if (cancelled) return;

        setEvents(mapped);
        setDismissed(readIdSet(DISMISSED_KEY));

        // New-event popup: any currently-live event never seen before.
        const seen = readIdSet(SEEN_KEY);
        const firstUnseenLive = mapped.find((e) => e.isLive && !seen.has(e.id));
        if (firstUnseenLive) {
          setNewEventPopup(firstUnseenLive);
        }
        // Mark every event returned as seen so the popup never repeats,
        // whether or not it was live yet (it'll show once it goes live).
        const seenNow = new Set(seen);
        for (const e of mapped) if (e.isLive) seenNow.add(e.id);
        writeIdSet(SEEN_KEY, seenNow);
      } catch {
        // Silent — this is a promotional, non-critical widget.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function dismissStrip(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      writeIdSet(DISMISSED_KEY, next);
      return next;
    });
  }

  const promoted = events.find((e) => !dismissed.has(e.id));

  return (
    <>
      {newEventPopup && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="new-event-popup-title"
          className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
            <span className="text-4xl">🎉</span>
            <h2 id="new-event-popup-title" className="mt-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">
              New Event: {newEventPopup.name}
            </h2>
            {newEventPopup.description && (
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{newEventPopup.description}</p>
            )}
            {newEventPopup.xpMultiplier > 1 && (
              <p className="mt-2 text-sm font-semibold text-amber-600 dark:text-amber-400">
                {newEventPopup.xpMultiplier}× XP is live now!
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setNewEventPopup(null)}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
              >
                Dismiss
              </button>
              <Link
                href="/events"
                onClick={() => setNewEventPopup(null)}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700"
              >
                View Event
              </Link>
            </div>
          </div>
        </div>
      )}

      {promoted && (
        <Link
          href="/events"
          className="flex items-center justify-between gap-3 bg-gradient-to-r from-blue-600 to-teal-600 px-4 py-2 text-white hover:opacity-95"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {promoted.isLive ? "🔴 Live now: " : "📅 Coming up: "}
            {promoted.name}
            {promoted.xpMultiplier > 1 && ` — ${promoted.xpMultiplier}× XP`}
          </span>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dismissStrip(promoted.id);
            }}
            aria-label="Dismiss event promo"
            className="shrink-0 rounded p-1 text-white/90 hover:text-white"
          >
            ✕
          </button>
        </Link>
      )}
    </>
  );
}
