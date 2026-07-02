/**
 * apps/android/src/routes/quests.tsx
 *
 * Daily Quests screen — mirrors the web page (apps/web/app/(app)/quests/page.tsx):
 * the user's daily quest deck with progress bars, XP/coin rewards, a
 * midnight-UTC reset countdown, and a Sponsored Quests section (currently
 * always empty — GET /api/quests/daily never actually sets is_sponsored on
 * the backend, so this mirrors the web page's defensive-but-dormant code).
 */

import { useState, useEffect, useCallback } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

type QuestDifficulty = 'easy' | 'medium' | 'hard';
type QuestTrack = 'social' | 'knowledge' | 'wealth' | 'influence' | 'resilience' | 'legacy' | 'main';

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

const VALID_TRACKS = new Set<QuestTrack>(['social', 'knowledge', 'wealth', 'influence', 'resilience', 'legacy', 'main']);

const DIFFICULTY_COLORS: Record<QuestDifficulty, string> = {
  easy: '#22c55e',
  medium: '#f59e0b',
  hard: '#ef4444',
};

const TRACK_EMOJIS: Record<QuestTrack, string> = {
  social: '💬',
  knowledge: '📚',
  wealth: '💰',
  influence: '⭐',
  resilience: '🛡️',
  legacy: '⚜️',
  main: '🎯',
};

function formatTimeUntilReset(resetAt: string): string {
  const diff = new Date(resetAt).getTime() - Date.now();
  if (diff <= 0) return '00:00:00';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Raw quest row shape returned by GET /api/quests/daily (snake_case).
interface QuestRow {
  id: string;
  title: string;
  name?: string;
  description: string;
  difficulty?: string;
  category?: string;
  track?: string;
  xp_reward?: number;
  coin_reward?: number;
  progress_count?: number;
  target_count?: number;
  completed?: boolean;
  is_sponsored?: boolean;
  sponsor_name?: string;
}

async function fetchDeck(): Promise<QuestDeckResponse> {
  const { data } = await apiClient.get<{
    date: string;
    quests: QuestRow[];
    total: number;
    completed: number;
    bonus_unlocked: boolean;
  }>('/quests/daily');

  const quests: Quest[] = (data.quests ?? []).map((q) => ({
    id: q.id,
    title: q.title ?? q.name ?? '',
    description: q.description ?? '',
    difficulty: (['easy', 'medium', 'hard'].includes(String(q.difficulty)) ? q.difficulty : 'medium') as QuestDifficulty,
    track: (VALID_TRACKS.has((q.category ?? q.track) as QuestTrack) ? (q.category ?? q.track) : 'main') as QuestTrack,
    xpReward: Number(q.xp_reward ?? 0),
    coinReward: Number(q.coin_reward ?? 0),
    currentProgress: Number(q.progress_count ?? 0),
    targetProgress: Number(q.target_count ?? 1),
    isCompleted: Boolean(q.completed ?? false),
    isSponsored: Boolean(q.is_sponsored ?? false),
    sponsorName: q.sponsor_name,
  }));

  const today = String(data.date ?? new Date().toISOString().slice(0, 10));
  const resetDate = new Date(`${today}T00:00:00Z`);
  resetDate.setUTCDate(resetDate.getUTCDate() + 1);

  return {
    quests,
    completedCount: Number(data.completed ?? 0),
    totalCount: Number(data.total ?? quests.length),
    resetAt: resetDate.toISOString(),
    bonusUnlocked: Boolean(data.bonus_unlocked ?? false),
  };
}

function QuestSkeleton() {
  return (
    <div className="space-y-3 px-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-neutral-100 rounded-xl p-4 animate-pulse">
          <div className="flex justify-between mb-2">
            <div className="h-4 bg-neutral-300 rounded w-2/3" />
            <div className="h-4 bg-neutral-300 rounded w-16" />
          </div>
          <div className="h-2 bg-neutral-200 rounded-full mt-3" />
        </div>
      ))}
    </div>
  );
}

function QuestCard({ quest }: { quest: Quest }) {
  const { t } = useTranslation();
  const progress = quest.targetProgress > 0 ? Math.min((quest.currentProgress / quest.targetProgress) * 100, 100) : 0;

  return (
    <div
      className={`rounded-xl border p-4 ${
        quest.isCompleted ? 'bg-success-50 border-success-200' : 'bg-white border-neutral-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-xl mt-0.5">{TRACK_EMOJIS[quest.track]}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold truncate ${quest.isCompleted ? 'line-through text-neutral-400' : 'text-neutral-900'}`}>
                {quest.title}
              </span>
              {quest.isSponsored && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  {t('quests.sponsored')} · {quest.sponsorName}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">{quest.description}</p>
          </div>
        </div>

        <div className="text-right shrink-0">
          {quest.xpReward > 0 && <div className="text-xs font-bold text-primary-600">+{quest.xpReward} XP</div>}
          {quest.coinReward > 0 && <div className="text-xs font-bold text-amber-500">+{quest.coinReward} 🪙</div>}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${DIFFICULTY_COLORS[quest.difficulty]}22`, color: DIFFICULTY_COLORS[quest.difficulty] }}
        >
          {quest.difficulty.charAt(0).toUpperCase() + quest.difficulty.slice(1)}
        </span>
        <span className="text-xs text-neutral-400">
          {quest.currentProgress} / {quest.targetProgress}
        </span>
      </div>

      <div className="mt-2 h-2 bg-neutral-200 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress}%`, backgroundColor: quest.isCompleted ? '#22c55e' : '#2563eb' }}
        />
      </div>
    </div>
  );
}

function QuestsPage() {
  const { t } = useTranslation();
  const [timeLeft, setTimeLeft] = useState('');
  const { data, status, refetch } = useQuery({ queryKey: ['quests', 'daily'], queryFn: fetchDeck, staleTime: 30_000 });

  const tick = useCallback(() => {
    if (data?.resetAt) setTimeLeft(formatTimeUntilReset(data.resetAt));
  }, [data?.resetAt]);

  useEffect(() => {
    if (!data?.resetAt) return;
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data?.resetAt, tick]);

  const regular = data?.quests.filter((q) => !q.isSponsored) ?? [];
  const sponsored = data?.quests.filter((q) => q.isSponsored) ?? [];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{t('quests.title')}</h1>
          <p className="text-sm text-neutral-500 mt-0.5">{t('quests.subtitle')}</p>
        </div>
        {data && (
          <div className="text-right shrink-0">
            <div className="text-xs text-neutral-400 font-medium">{t('quests.resetsIn')}</div>
            <div className="text-base font-mono font-bold text-neutral-700">{timeLeft}</div>
          </div>
        )}
      </div>

      {data && (
        <div className="mx-4 mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-blue-700">
                {t('quests.completed', { count: data.completedCount, total: data.totalCount })}
              </div>
              {data.bonusUnlocked && <div className="text-xs text-blue-500 mt-0.5">🎉 {t('quests.bonusUnlocked')}</div>}
            </div>
            <div className="text-2xl font-extrabold text-blue-600">
              {data.totalCount > 0 ? Math.round((data.completedCount / data.totalCount) * 100) : 0}%
            </div>
          </div>
          <div className="mt-2 h-2 bg-blue-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all"
              style={{ width: `${data.totalCount > 0 ? (data.completedCount / data.totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {status === 'pending' ? (
        <QuestSkeleton />
      ) : status === 'error' ? (
        <div className="text-center py-12 px-4">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-neutral-500">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold">
            {t('quests.retry')}
          </button>
        </div>
      ) : data?.quests.length === 0 ? (
        <div className="text-center py-12 px-4">
          <div className="text-4xl mb-3">🎯</div>
          <p className="text-neutral-500">{t('quests.noQuests')}</p>
        </div>
      ) : (
        <div className="space-y-3 px-4 pb-6">
          {regular.map((q) => (
            <QuestCard key={q.id} quest={q} />
          ))}

          {sponsored.length > 0 && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-neutral-200" />
                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{t('quests.sponsoredQuests')}</span>
                <div className="flex-1 h-px bg-neutral-200" />
              </div>
              {sponsored.map((q) => (
                <QuestCard key={q.id} quest={q} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/quests')({
  component: QuestsPage,
});
