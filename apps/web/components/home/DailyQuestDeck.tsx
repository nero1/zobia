"use client";

/**
 * components/home/DailyQuestDeck.tsx
 *
 * Relocated, unchanged-behavior Daily Quest Deck — was inline in
 * app/(app)/home/page.tsx as `QuestDeck`/`QuestDeckSkeleton`. Fetches
 * GET /api/quests/daily and refetches on realtime quest-progress events
 * (useFloatingNotification's questUpdateKey), plus login streak from
 * GET /api/users/me, exactly as before.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFloatingNotification } from "@/hooks/useFloatingNotification";

interface DailyQuest {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  coinReward: number;
  progress: number;
  goal: number;
  completed: boolean;
}

interface DailyQuestApiRow {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  xp_reward?: unknown;
  xpReward?: unknown;
  coin_reward?: unknown;
  coinReward?: unknown;
  progress_count?: unknown;
  progress?: unknown;
  target_count?: unknown;
  goal?: unknown;
  completed?: unknown;
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function QuestDeckSkeleton() {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <SkeletonBlock className="h-4 w-28" />
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse px-5 py-4">
            <div className="flex items-start gap-3">
              <SkeletonBlock className="mt-0.5 h-5 w-5 rounded-full" />
              <div className="flex-1 space-y-2">
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-3 w-full" />
                <SkeletonBlock className="h-2 w-full rounded-full" />
              </div>
              <SkeletonBlock className="h-5 w-14 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DailyQuestDeck() {
  const { t } = useTranslation();
  const { questUpdateKey } = useFloatingNotification();
  const [quests, setQuests] = useState<DailyQuest[] | undefined>(undefined);
  const [loginStreak, setLoginStreak] = useState(0);

  const fetchQuests = useCallback(() => {
    fetch("/api/quests/daily", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { quests?: DailyQuestApiRow[] } | null) => {
        const mapped: DailyQuest[] = (d?.quests ?? []).map((q) => ({
          id: String(q.id ?? ""),
          title: String(q.title ?? ""),
          description: String(q.description ?? ""),
          xpReward: Number(q.xp_reward ?? q.xpReward ?? 0),
          coinReward: Number(q.coin_reward ?? q.coinReward ?? 0),
          progress: Number(q.progress_count ?? q.progress ?? 0),
          goal: Number(q.target_count ?? q.goal ?? 1),
          completed: Boolean(q.completed ?? false),
        }));
        setQuests(mapped);
      })
      .catch(() => setQuests([]));
  }, []);

  useEffect(() => {
    fetchQuests();
  }, [fetchQuests]);

  useEffect(() => {
    if (questUpdateKey === 0) return;
    fetchQuests();
  }, [questUpdateKey, fetchQuests]);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { login_streak?: number } } | null) => {
        setLoginStreak(d?.user?.login_streak ?? 0);
      })
      .catch(() => {});
  }, []);

  if (quests === undefined) return <QuestDeckSkeleton />;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("home.quests.dailyTitle")}</h2>
        {loginStreak > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/50 dark:text-orange-300">
            🔥 {t("home.quests.streak", { count: loginStreak })}
          </span>
        )}
      </div>
      {quests.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-neutral-500">{t("home.quests.empty")}</div>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {quests.map((q) => {
            const pct = q.goal > 0 ? Math.min(100, Math.round((q.progress / q.goal) * 100)) : 0;
            return (
              <div key={q.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${q.completed ? "border-teal-500 bg-teal-500 text-white" : "border-neutral-300 dark:border-neutral-600"}`}
                  >
                    {q.completed && (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${q.completed ? "text-neutral-400 line-through dark:text-neutral-500" : "text-neutral-900 dark:text-neutral-100"}`}>
                      {q.title}
                    </p>
                    {q.description && (
                      <p className="mt-0.5 text-xs text-neutral-500">{q.description}</p>
                    )}
                    {!q.completed && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                          <span className="tabular-nums">{q.progress} / {q.goal}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                          <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                    +{q.xpReward} XP
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
