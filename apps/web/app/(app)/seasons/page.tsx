"use client";

/**
 * app/(app)/seasons/page.tsx
 *
 * Seasons page (web version).
 * Active season hero with pass progress, leaderboard top 10, season history grid.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveSeason {
  id: string;
  name: string;
  theme: string;
  startAt: string;
  endAt: string;
  passPrice: number; // coins
  hasPaidPass: boolean;
  freePassLevel: number;
  paidPassLevel: number;
  maxPassLevel: number;
  freePassXp: number;
  freePassXpForNext: number;
}

interface SeasonLeaderEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  xp: number;
  isCurrentUser: boolean;
}

interface PastSeason {
  id: string;
  name: string;
  year: number;
  theme: string;
  userRank: number | null;
  userTier: string | null;
}

interface SeasonsData {
  activeSeason: ActiveSeason | null;
  leaderboard: SeasonLeaderEntry[];
  pastSeasons: PastSeason[];
}

// ---------------------------------------------------------------------------
// Milestone types
// ---------------------------------------------------------------------------

interface MilestoneReward {
  type: "coins" | "badge" | "title" | "sticker_pack" | string;
  value: string | number;
  label: string;
}

interface SeasonMilestone {
  id: string;
  level: number;
  xpThreshold: number;
  tier: "free" | "paid";
  reward: MilestoneReward;
  claimed: boolean;
  claimable: boolean;
}

interface SeasonPassData {
  milestones: SeasonMilestone[];
  currentXp: number;
  hasPaidPass: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysRemaining(endAt: string): number {
  return Math.max(0, Math.ceil((new Date(endAt).getTime() - Date.now()) / 86_400_000));
}

function totalDays(startAt: string, endAt: string): number {
  return Math.max(1, Math.ceil((new Date(endAt).getTime() - new Date(startAt).getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-3 h-7 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-4 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pass card
// ---------------------------------------------------------------------------

interface PassCardProps {
  season: ActiveSeason;
  onUpgrade: () => void;
  upgrading: boolean;
}

function PassCard({ season, onUpgrade, upgrading }: PassCardProps) {
  const pct = season.freePassXpForNext > 0
    ? Math.min(100, Math.round((season.freePassXp / season.freePassXpForNext) * 100))
    : 100;
  const overallPct = Math.round((season.freePassLevel / season.maxPassLevel) * 100);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">Season Pass</h2>
          <div className="mt-1 flex items-center gap-2">
            {season.hasPaidPass ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">Paid Pass ⭐</span>
            ) : (
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">Free Pass</span>
            )}
          </div>
        </div>
        {!season.hasPaidPass && (
          <button
            onClick={onUpgrade}
            disabled={upgrading}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {upgrading ? "Processing…" : `Upgrade · ${season.passPrice.toLocaleString()} 🪙`}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>Level {season.freePassLevel} / {season.maxPassLevel}</span>
          <span className="tabular-nums">{pct}% to next level</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div
            className="h-full rounded-full bg-amber-500 transition-all"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-blue-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-neutral-400">
          {season.freePassXp.toLocaleString()} / {season.freePassXpForNext.toLocaleString()} XP
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Milestone reward track
// ---------------------------------------------------------------------------

function milestoneRewardLabel(reward: MilestoneReward): string {
  if (reward.label) return reward.label;
  switch (reward.type) {
    case "coins": return `${Number(reward.value).toLocaleString()} 🪙`;
    case "badge": return `Badge: ${reward.value}`;
    case "title": return `Title: "${reward.value}"`;
    case "sticker_pack": return `Sticker Pack: ${reward.value}`;
    default: return String(reward.value);
  }
}

interface MilestoneTrackProps {
  passData: SeasonPassData;
  onClaim: (milestoneId: string) => Promise<void>;
  claiming: string | null;
}

function MilestoneTrack({ passData, onClaim, claiming }: MilestoneTrackProps) {
  const freeMilestones = passData.milestones.filter((m) => m.tier === "free");
  const paidMilestones = passData.milestones.filter((m) => m.tier === "paid");

  function MilestoneNode({ m }: { m: SeasonMilestone }) {
    const reached = passData.currentXp >= m.xpThreshold;
    return (
      <div className="flex flex-col items-center gap-1.5 min-w-0">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
            m.claimed
              ? "border-teal-500 bg-teal-500 text-white"
              : reached
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "border-neutral-300 bg-white text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
          }`}
        >
          {m.claimed ? "✓" : m.level}
        </div>
        <p className="max-w-[5rem] truncate text-center text-xs text-neutral-500">
          {milestoneRewardLabel(m.reward)}
        </p>
        <p className="text-xs font-semibold tabular-nums text-neutral-400">
          {m.xpThreshold.toLocaleString()} XP
        </p>
        {m.claimable && !m.claimed && (
          <button
            onClick={() => onClaim(m.id)}
            disabled={claiming === m.id}
            className="rounded-lg bg-teal-600 px-2 py-1 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {claiming === m.id ? "…" : "Claim"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Season Pass Milestones</h2>

      <div className="mb-4 text-xs text-neutral-500">
        Your XP:{" "}
        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
          {passData.currentXp.toLocaleString()}
        </span>
      </div>

      {/* Free track */}
      {freeMilestones.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              Free Track
            </span>
          </div>
          <div className="flex items-start gap-3 overflow-x-auto pb-2">
            {freeMilestones.map((m, i) => (
              <div key={m.id} className="flex items-start gap-0">
                <MilestoneNode m={m} />
                {i < freeMilestones.length - 1 && (
                  <div
                    className={`mt-4 h-0.5 w-8 shrink-0 self-start ${
                      passData.currentXp >= freeMilestones[i + 1]?.xpThreshold
                        ? "bg-blue-400"
                        : "bg-neutral-200 dark:bg-neutral-700"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paid track */}
      {paidMilestones.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              Paid Track ⭐
            </span>
            {!passData.hasPaidPass && (
              <span className="text-xs text-neutral-400">(Requires Paid Pass)</span>
            )}
          </div>
          <div className={`flex items-start gap-3 overflow-x-auto pb-2 ${!passData.hasPaidPass ? "opacity-50" : ""}`}>
            {paidMilestones.map((m, i) => (
              <div key={m.id} className="flex items-start gap-0">
                <MilestoneNode m={m} />
                {i < paidMilestones.length - 1 && (
                  <div
                    className={`mt-4 h-0.5 w-8 shrink-0 self-start ${
                      passData.hasPaidPass && passData.currentXp >= paidMilestones[i + 1]?.xpThreshold
                        ? "bg-amber-400"
                        : "bg-neutral-200 dark:bg-neutral-700"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Seasons page — active season hero, pass, milestones, leaderboard, and history.
 */
export default function SeasonsPage() {
  const [data, setData] = useState<SeasonsData | null>(null);
  const [passData, setPassData] = useState<SeasonPassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/seasons", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (!res.ok) throw new Error("Failed to load seasons");
        const seasonsData = (await res.json()) as SeasonsData;
        setData(seasonsData);

        // Fetch milestones for active season
        if (seasonsData.activeSeason) {
          fetch(`/api/seasons/${seasonsData.activeSeason.id}/pass`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d: SeasonPassData | null) => { if (d) setPassData(d); })
            .catch(() => {});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleUpgrade() {
    setUpgrading(true);
    try {
      const res = await fetch("/api/seasons/pass/upgrade", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed to upgrade");
      setData((prev) => prev && prev.activeSeason
        ? { ...prev, activeSeason: { ...prev.activeSeason, hasPaidPass: true } }
        : prev
      );
    } catch { /* ignore */ }
    setUpgrading(false);
  }

  async function handleClaimMilestone(milestoneId: string) {
    setClaiming(milestoneId);
    try {
      const seasonId = data?.activeSeason?.id;
      if (!seasonId) return;
      const res = await fetch(`/api/seasons/${seasonId}/pass/claim`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneId }),
      });
      if (!res.ok) return;
      setPassData((prev) =>
        prev
          ? {
              ...prev,
              milestones: prev.milestones.map((m) =>
                m.id === milestoneId ? { ...m, claimed: true, claimable: false } : m
              ),
            }
          : prev
      );
    } catch { /* ignore */ }
    setClaiming(null);
  }

  if (loading) return <div className="mx-auto max-w-3xl p-4 sm:p-6"><PageSkeleton /></div>;

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      </div>
    );
  }

  const { activeSeason, leaderboard, pastSeasons } = data ?? { activeSeason: null, leaderboard: [], pastSeasons: [] };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Seasons</h1>

      {/* Active season hero */}
      {activeSeason ? (
        <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-card dark:border-blue-800 dark:bg-neutral-900">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">Active Season</span>
              <h2 className="mt-2 text-xl font-bold text-neutral-900 dark:text-neutral-50">{activeSeason.name}</h2>
              <p className="text-sm text-neutral-500">{activeSeason.theme}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-blue-600">{daysRemaining(activeSeason.endAt)}</p>
              <p className="text-xs text-neutral-500">days left</p>
            </div>
          </div>

          {/* Days progress bar */}
          <div>
            <div className="h-2.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{
                  width: `${Math.min(100, Math.round(
                    ((totalDays(activeSeason.startAt, activeSeason.endAt) - daysRemaining(activeSeason.endAt)) /
                      totalDays(activeSeason.startAt, activeSeason.endAt)) * 100
                  ))}%`,
                }}
              />
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              Season ends {new Date(activeSeason.endAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-neutral-500">No active season right now. Check back soon!</p>
        </div>
      )}

      {/* Season pass */}
      {activeSeason && (
        <PassCard season={activeSeason} onUpgrade={handleUpgrade} upgrading={upgrading} />
      )}

      {/* Milestone reward track */}
      {activeSeason && passData && passData.milestones.length > 0 && (
        <MilestoneTrack
          passData={passData}
          onClaim={handleClaimMilestone}
          claiming={claiming}
        />
      )}

      {/* Season leaderboard */}
      {leaderboard.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Season Top 10</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-3 text-left font-semibold">Rank</th>
                  <th className="px-4 py-3 text-left font-semibold">Player</th>
                  <th className="px-4 py-3 text-right font-semibold">XP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {leaderboard.map((entry) => (
                  <tr
                    key={entry.userId}
                    className={`${entry.isCurrentUser ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"}`}
                  >
                    <td className="px-4 py-3 font-bold tabular-nums text-neutral-700 dark:text-neutral-300">
                      {entry.rank <= 3 ? ["🥇", "🥈", "🥉"][entry.rank - 1] : `#${entry.rank}`}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/profile/${entry.userId}`} className="flex items-center gap-2 hover:underline">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-lg dark:bg-neutral-800">
                          {entry.avatarEmoji}
                        </span>
                        <div>
                          <p className="font-semibold text-neutral-900 dark:text-neutral-100">{entry.displayName}</p>
                          <p className="text-xs text-neutral-400">@{entry.username}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">
                      {entry.xp.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
            <Link href="/leaderboards?scope=season" className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
              View full leaderboard →
            </Link>
          </div>
        </div>
      )}

      {/* Season history */}
      {pastSeasons.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Season History</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {pastSeasons.map((s) => (
              <div key={s.id} className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-xs text-neutral-400">{s.year}</p>
                <p className="mt-0.5 truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">{s.name}</p>
                <p className="text-xs text-neutral-500">{s.theme}</p>
                {s.userRank ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-base font-bold text-amber-600">#{s.userRank}</span>
                    {s.userTier && <span className="text-xs text-neutral-500">{s.userTier}</span>}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-neutral-400">Unranked</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
