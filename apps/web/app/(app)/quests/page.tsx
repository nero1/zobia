"use client";

/**
 * app/(app)/quests/page.tsx
 *
 * Daily Quests page.
 * - Shows the user's daily quest deck (3–6 quests based on plan)
 * - Progress bars on each quest
 * - Coin/XP reward display
 * - Resets at midnight UTC (countdown timer)
 * - Sponsored quests section at the bottom
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuestDifficulty = "easy" | "medium" | "hard";
type QuestTrack = "social" | "knowledge" | "wealth" | "influence" | "resilience" | "legacy" | "main";

interface Quest {
  id: string;
  title: string;
  description: string;
  difficulty: QuestDifficulty;
  track: QuestTrack;
  xpReward: number;
  coinReward: number;
  currentProgress: number;
  targetProgress: number;
  isCompleted: boolean;
  isSponsored: boolean;
  sponsorName?: string;
}

interface QuestDeckResponse {
  quests: Quest[];
  completedCount: number;
  totalCount: number;
  resetAt: string;
  bonusUnlocked: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIFFICULTY_COLORS: Record<QuestDifficulty, string> = {
  easy: "#22c55e",
  medium: "#f59e0b",
  hard: "#ef4444",
};

const TRACK_EMOJIS: Record<QuestTrack, string> = {
  social: "💬",
  knowledge: "📚",
  wealth: "💰",
  influence: "⭐",
  resilience: "🛡️",
  legacy: "⚜️",
  main: "🎯",
};

function formatTimeUntilReset(resetAt: string): string {
  const diff = new Date(resetAt).getTime() - Date.now();
  if (diff <= 0) return "00:00:00";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function QuestSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-neutral-100 dark:bg-neutral-800 rounded-xl p-4 animate-pulse">
          <div className="flex justify-between mb-2">
            <div className="h-4 bg-neutral-300 dark:bg-neutral-600 rounded w-2/3" />
            <div className="h-4 bg-neutral-300 dark:bg-neutral-600 rounded w-16" />
          </div>
          <div className="h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full mt-3" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuestCard
// ---------------------------------------------------------------------------

function QuestCard({ quest }: { quest: Quest }) {
  const progress = quest.targetProgress > 0
    ? Math.min((quest.currentProgress / quest.targetProgress) * 100, 100)
    : 0;

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        quest.isCompleted
          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
          : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-xl mt-0.5">{TRACK_EMOJIS[quest.track]}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-sm font-semibold truncate ${
                  quest.isCompleted ? "line-through text-neutral-400" : "text-neutral-900 dark:text-neutral-100"
                }`}
              >
                {quest.title}
              </span>
              {quest.isSponsored && (
                <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">
                  Sponsored · {quest.sponsorName}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{quest.description}</p>
          </div>
        </div>

        {/* Rewards */}
        <div className="text-right shrink-0">
          {quest.xpReward > 0 && (
            <div className="text-xs font-bold text-blue-600 dark:text-blue-400">+{quest.xpReward} XP</div>
          )}
          {quest.coinReward > 0 && (
            <div className="text-xs font-bold text-amber-500">+{quest.coinReward} 🪙</div>
          )}
        </div>
      </div>

      {/* Difficulty badge */}
      <div className="flex items-center gap-2 mt-2">
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: `${DIFFICULTY_COLORS[quest.difficulty]}22`,
            color: DIFFICULTY_COLORS[quest.difficulty],
          }}
        >
          {quest.difficulty.charAt(0).toUpperCase() + quest.difficulty.slice(1)}
        </span>
        <span className="text-xs text-neutral-400">
          {quest.currentProgress} / {quest.targetProgress}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            backgroundColor: quest.isCompleted ? "#22c55e" : "#2563eb",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function QuestsPage() {
  const [data, setData] = useState<QuestDeckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/quests/daily");
      if (!res.ok) throw new Error("Failed to load quests");
      const json = await res.json();

      const VALID_TRACKS = new Set<QuestTrack>(["social","knowledge","wealth","influence","resilience","legacy","main"]);

      // Map API snake_case / alternate fields to the Quest interface
      const quests: Quest[] = (json.quests ?? []).map((q: Record<string, unknown>): Quest => ({
        id: String(q.id ?? ""),
        title: String(q.title ?? q.name ?? ""),
        description: String(q.description ?? ""),
        difficulty: (["easy","medium","hard"].includes(String(q.difficulty)) ? q.difficulty : "medium") as QuestDifficulty,
        track: (VALID_TRACKS.has(String(q.category ?? q.track) as QuestTrack)
          ? (q.category ?? q.track)
          : "main") as QuestTrack,
        xpReward: Number(q.xp_reward ?? q.xpReward ?? 0),
        coinReward: Number(q.coin_reward ?? q.coinReward ?? 0),
        currentProgress: Number(q.progress_count ?? q.currentProgress ?? 0),
        targetProgress: Number(q.target_count ?? q.targetProgress ?? 1),
        isCompleted: Boolean(q.completed ?? q.isCompleted ?? false),
        isSponsored: Boolean(q.is_sponsored ?? q.isSponsored ?? false),
        sponsorName: q.sponsor_name != null ? String(q.sponsor_name) : q.sponsorName != null ? String(q.sponsorName) : undefined,
      }));

      const today = String(json.date ?? new Date().toISOString().slice(0, 10));
      const resetDate = new Date(`${today}T00:00:00Z`);
      resetDate.setUTCDate(resetDate.getUTCDate() + 1);

      setData({
        quests,
        completedCount: Number(json.completed ?? json.completedCount ?? 0),
        totalCount: Number(json.total ?? json.totalCount ?? quests.length),
        resetAt: resetDate.toISOString(),
        bonusUnlocked: Boolean(json.bonus_unlocked ?? json.bonusUnlocked ?? false),
      });
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

  // Countdown to midnight reset
  useEffect(() => {
    if (!data?.resetAt) return;
    const tick = () => setTimeLeft(formatTimeUntilReset(data.resetAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data?.resetAt]);

  const regular = data?.quests.filter((q) => !q.isSponsored) ?? [];
  const sponsored = data?.quests.filter((q) => q.isSponsored) ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-100">Daily Quests</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Complete quests to earn XP and Coins
          </p>
        </div>
        {data && (
          <div className="text-right">
            <div className="text-xs text-neutral-400 font-medium">Resets in</div>
            <div className="text-lg font-mono font-bold text-neutral-700 dark:text-neutral-300">{timeLeft}</div>
          </div>
        )}
      </div>

      {/* Progress summary */}
      {data && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                {data.completedCount} / {data.totalCount} completed
              </div>
              {data.bonusUnlocked && (
                <div className="text-xs text-blue-500 mt-0.5">🎉 All quests complete — bonus XP awarded!</div>
              )}
            </div>
            <div className="text-2xl font-extrabold text-blue-600 dark:text-blue-400">
              {data.totalCount > 0 ? Math.round((data.completedCount / data.totalCount) * 100) : 0}%
            </div>
          </div>
          <div className="mt-2 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 dark:bg-blue-400 rounded-full transition-all"
              style={{ width: `${data.totalCount > 0 ? (data.completedCount / data.totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Quest list */}
      {loading ? (
        <QuestSkeleton />
      ) : error ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-neutral-500 dark:text-neutral-400">{error}</p>
          <button
            onClick={load}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      ) : data?.quests.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🎯</div>
          <p className="text-neutral-500 dark:text-neutral-400">No quests available right now. Check back later!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {regular.map((q) => <QuestCard key={q.id} quest={q} />)}

          {sponsored.length > 0 && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Sponsored Quests</span>
                <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
              </div>
              {sponsored.map((q) => <QuestCard key={q.id} quest={q} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
