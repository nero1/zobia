/**
 * apps/android/src/components/home/DailyQuestDeck.tsx
 *
 * Home Dashboard's compact Daily Quest Deck card — mirrors
 * apps/web/components/home/DailyQuestDeck.tsx. Fetches GET /api/quests/daily
 * (same shape as routes/quests/index.tsx's full Quests page) and the login
 * streak from GET /api/users/me. No realtime quest-progress refetch signal
 * exists in this app yet (web's useFloatingNotification().questUpdateKey
 * has no Android equivalent — see components/notifications/
 * FloatingRewardProvider.tsx, which doesn't track quest progress); pull-to-
 * refresh on the Home logo tab remounts this component instead, which is
 * an acceptable simplification for a dashboard summary card (the full
 * Quests page stays the source of truth for live progress).
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { Icon } from '@/components/ui/Icon';

interface DailyQuest {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  coinReward: number;
  progress: number;
  goal: number;
  completed: boolean;
  actionUrl: string;
}

interface DailyQuestApiRow {
  actionUrl?: unknown;
  id?: unknown;
  title?: unknown;
  name?: unknown;
  description?: unknown;
  xp_reward?: unknown;
  coin_reward?: unknown;
  progress_count?: unknown;
  target_count?: unknown;
  completed?: unknown;
}

async function fetchDailyQuests() {
  const { data } = await apiClient.get<{ quests?: DailyQuestApiRow[]; xpToLevel2?: number }>('/quests/daily');
  const quests: DailyQuest[] = (data?.quests ?? []).map((q) => ({
    id: String(q.id ?? ''),
    actionUrl: typeof q.actionUrl === 'string' ? q.actionUrl : '/quests',
    title: String(q.title ?? q.name ?? ''),
    description: String(q.description ?? ''),
    xpReward: Number(q.xp_reward ?? 0),
    coinReward: Number(q.coin_reward ?? 0),
    progress: Number(q.progress_count ?? 0),
    goal: Number(q.target_count ?? 1),
    completed: Boolean(q.completed ?? false),
  }));
  return { quests, xpToLevel2: data?.xpToLevel2 ?? 0 };
}

async function fetchLoginStreak(): Promise<number> {
  const { data } = await apiClient.get<{ user?: { login_streak?: number } }>('/users/me');
  return data?.user?.login_streak ?? 0;
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function QuestDeckSkeleton() {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm">
      <div className="border-b border-neutral-200 dark:border-neutral-700 px-5 py-4">
        <SkeletonBlock className="h-4 w-28" />
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
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
  const [tipIndex,setTipIndex] = useState(0);
  const [tipsHidden,setTipsHidden] = useState(false);
  const { data: deck, isPending } = useQuery({ queryKey: ['home', 'quests', 'daily'], queryFn: fetchDailyQuests });
  const { data: loginStreak = 0 } = useQuery({ queryKey: ['home', 'quests', 'loginStreak'], queryFn: fetchLoginStreak });

  const quests = deck?.quests; const xpToLevel2 = deck?.xpToLevel2 ?? 0;
  const tips = quests?.filter((q)=>!q.completed && q.xpReward>0) ?? [];
  const tip = tips.length ? tips[tipIndex % tips.length] : undefined;
  if (isPending || !quests) return <QuestDeckSkeleton />;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm">
      {!tipsHidden && (tip || xpToLevel2>0) && <aside className="rounded-t-xl bg-blue-50 dark:bg-blue-950 p-4 text-sm">
        <div className="flex justify-between gap-3"><strong>{t('home.tips.title','Tips for your progress')}</strong><button type="button" onClick={()=>setTipsHidden(true)} aria-label={t('home.tips.dismiss','Dismiss tips')}>×</button></div>
        {xpToLevel2>0 && <p className="mt-2">{t('home.tips.level2','Earn {{xp}} more XP to reach Level 2 and unlock more features and higher limits.',{xp:xpToLevel2})}</p>}
        {tip && <p className="mt-2"><Link to={tip.actionUrl as never} className="underline">{t('home.tips.earn','Earn {{xp}} XP by completing: {{action}}',{xp:tip.xpReward,action:tip.title})}</Link></p>}
        {tips.length>1 && <button type="button" onClick={()=>setTipIndex((n)=>n+1)} className="mt-2 underline">{t('home.tips.next','Another tip')}</button>}
      </aside>}
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700 px-5 py-4">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t('home.quests.dailyTitle')}</h2>
        {loginStreak > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
            <Icon emoji="🔥" size={12} />
            {t('home.quests.streak', { count: loginStreak })}
          </span>
        )}
      </div>
      {quests.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">{t('home.quests.empty')}</div>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
          {quests.map((q) => {
            const pct = q.goal > 0 ? Math.min(100, Math.round((q.progress / q.goal) * 100)) : 0;
            return (
              <div key={q.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${q.completed ? 'border-teal-500 bg-teal-500 text-white' : 'border-neutral-300 dark:border-neutral-600'}`}
                  >
                    {q.completed && (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${q.completed ? 'text-neutral-400 dark:text-neutral-500 line-through' : 'text-neutral-900 dark:text-neutral-100'}`}>
                      <Link to={q.actionUrl as never} className="hover:underline">{q.title}</Link>
                    </p>
                    {q.description && <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{q.description}</p>}
                    {!q.completed && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-neutral-400 dark:text-neutral-500">
                          <span className="tabular-nums">
                            {q.progress} / {q.goal}
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                          <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
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
