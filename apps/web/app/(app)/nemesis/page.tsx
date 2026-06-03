"use client";

/**
 * app/(app)/nemesis/page.tsx
 *
 * Nemesis page.
 * - Shows the current assigned nemesis (matched by XP proximity, city, non-friend)
 * - Sprint standings (XP earned since challenge start for each party)
 * - Challenge actions (view profile, send challenge message)
 * - History of past nemesis matchups
 * - Weekly refresh countdown
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NemesisUser {
  userId: string;
  displayName: string;
  username: string;
  avatarEmoji: string;
  city: string | null;
  rankLabel: string;
  xpTotal: number;
  xpDelta: number;
}

interface SprintStanding {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  xpEarned: number;
  isMe: boolean;
}

interface NemesisData {
  matchId: string | null;
  nemesis: NemesisUser | null;
  me: NemesisUser | null;
  sprintStandings: SprintStanding[];
  challengeStartedAt: string | null;
  nextRefreshAt: string;
  isActive: boolean;
  myLead: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Soon";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function xpDiff(val: number): string {
  return val >= 0 ? `+${val.toLocaleString()}` : val.toLocaleString();
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function NemesisSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-48 bg-neutral-100 dark:bg-neutral-800 rounded-2xl" />
      <div className="h-32 bg-neutral-100 dark:bg-neutral-800 rounded-2xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nemesis card
// ---------------------------------------------------------------------------

function NemesisCard({ data }: { data: NemesisData }) {
  const { nemesis, me, sprintStandings, myLead } = data;

  if (!nemesis || !me) {
    return (
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 text-center">
        <div className="text-4xl mb-3">👻</div>
        <h3 className="font-bold text-neutral-700 dark:text-neutral-300 mb-1">No Nemesis Yet</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Keep earning XP — a nemesis will be assigned on Sunday when there&apos;s a close match.
        </p>
      </div>
    );
  }

  const isLeading = myLead >= 0;

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden">
      {/* VS header */}
      <div className="bg-gradient-to-r from-blue-600 to-red-600 p-1" />
      <div className="p-5">
        <div className="flex items-center justify-between gap-4">
          {/* Me */}
          <div className="flex flex-col items-center flex-1">
            <span className="text-4xl">{me.avatarEmoji}</span>
            <span className="font-bold text-sm mt-1 text-neutral-900 dark:text-neutral-100 truncate max-w-full">{me.displayName}</span>
            <span className="text-xs text-neutral-400">@{me.username}</span>
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400 mt-1">{me.xpTotal.toLocaleString()} XP</span>
          </div>

          {/* VS */}
          <div className="flex flex-col items-center">
            <span className="text-xl font-black text-neutral-400">VS</span>
            <span className={`text-xs font-bold mt-1 ${isLeading ? "text-green-600" : "text-red-600"}`}>
              {isLeading ? `You lead by ${myLead.toLocaleString()}` : `Behind by ${Math.abs(myLead).toLocaleString()}`}
            </span>
          </div>

          {/* Nemesis */}
          <div className="flex flex-col items-center flex-1">
            <span className="text-4xl">{nemesis.avatarEmoji}</span>
            <span className="font-bold text-sm mt-1 text-neutral-900 dark:text-neutral-100 truncate max-w-full">{nemesis.displayName}</span>
            <span className="text-xs text-neutral-400">@{nemesis.username}</span>
            <span className="text-sm font-bold text-red-500 mt-1">{nemesis.xpTotal.toLocaleString()} XP</span>
          </div>
        </div>

        {/* City */}
        {nemesis.city && (
          <p className="text-xs text-center text-neutral-400 mt-3">📍 {nemesis.city}</p>
        )}

        {/* Sprint standings */}
        {sprintStandings.length > 0 && data.challengeStartedAt && (
          <div className="mt-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl p-3">
            <div className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">Sprint Standings</div>
            <div className="space-y-2">
              {sprintStandings.map((s) => (
                <div key={s.userId} className="flex items-center gap-2">
                  <span className="text-lg">{s.avatarEmoji}</span>
                  <span className={`text-sm font-semibold flex-1 ${s.isMe ? "text-blue-600 dark:text-blue-400" : "text-neutral-700 dark:text-neutral-300"}`}>
                    {s.displayName}{s.isMe ? " (You)" : ""}
                  </span>
                  <span className={`text-sm font-bold ${s.xpEarned > 0 ? "text-green-600" : "text-neutral-400"}`}>
                    {xpDiff(s.xpEarned)} XP
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <Link
            href={`/profile/${nemesis.userId}`}
            className="flex-1 text-center py-2 px-4 bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-lg text-sm font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
          >
            View Profile
          </Link>
          <button className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
            Challenge 🔥
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NemesisPage() {
  const [data, setData] = useState<NemesisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/nemesis");
      if (!res.ok) throw new Error("Failed to load nemesis");
      const json = await res.json();
      setData(json.data ?? json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data?.nextRefreshAt) return;
    const tick = () => setTimeLeft(formatTimeUntil(data.nextRefreshAt));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [data?.nextRefreshAt]);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-100">Your Nemesis</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          A rival matched to your XP level. Outperform them to climb.
        </p>
      </div>

      {/* Refresh countdown */}
      {data && (
        <div className="flex items-center gap-2 mb-4 text-xs text-neutral-400">
          <span>🔄</span>
          <span>Next refresh: <strong className="text-neutral-600 dark:text-neutral-300">{timeLeft || formatTimeUntil(data.nextRefreshAt)}</strong></span>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <NemesisSkeleton />
      ) : error ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-neutral-500">{error}</p>
          <button
            onClick={load}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <NemesisCard data={data!} />
      )}

      {/* How it works */}
      <div className="mt-6 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl p-4">
        <h3 className="text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-2">How Nemesis Works</h3>
        <ul className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          <li>• Matched weekly to someone within 10% of your XP</li>
          <li>• Same city preferred, never a mutual friend</li>
          <li>• Sprint tracks XP earned since the match started</li>
          <li>• Outrank your nemesis to earn bonus Legacy XP</li>
        </ul>
      </div>
    </div>
  );
}
