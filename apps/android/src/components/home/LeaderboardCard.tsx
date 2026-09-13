/**
 * apps/android/src/components/home/LeaderboardCard.tsx
 *
 * Mirrors apps/web/components/home/LeaderboardCard.tsx. Fetches rank from
 * GET /api/leaderboards/me and XP from GET /api/users/me.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface LeaderboardPosition {
  rank: number;
  xp: number;
}

async function fetchLeaderboardPosition(): Promise<LeaderboardPosition | null> {
  const [lbRes, meRes] = await Promise.all([
    apiClient.get<{ ranks?: Array<{ track: string; globalRank: number | null }> }>('/leaderboards/me').catch(() => null),
    apiClient.get<{ user?: { xp_total?: number } }>('/users/me').catch(() => null),
  ]);
  const ranks = lbRes?.data?.ranks ?? [];
  const mainRank = ranks.find((r) => r.track === 'main');
  const xp = meRes?.data?.user?.xp_total ?? 0;
  if (mainRank?.globalRank == null) return null;
  return { rank: mainRank.globalRank, xp };
}

function LeaderboardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
      <div className="mb-2 h-4 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mb-1 h-8 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

export function LeaderboardCard() {
  const { t } = useTranslation();
  const { data: position, isPending } = useQuery({ queryKey: ['home', 'leaderboard', 'me'], queryFn: fetchLeaderboardPosition });

  if (isPending) return <LeaderboardSkeleton />;
  if (!position) return null;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('home.leaderboard.title')}</h2>
      <div className="flex items-end gap-2">
        <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">#{position.rank.toLocaleString()}</p>
        <span className="mb-1 text-sm text-neutral-400 dark:text-neutral-500">{t('home.leaderboard.noChange')}</span>
      </div>
      <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{t('home.leaderboard.totalXp', { xp: position.xp.toLocaleString() })}</p>
      <Link to="/leaderboards" className="mt-3 block text-xs font-semibold text-primary-600 dark:text-primary-300">
        {t('home.leaderboard.viewFull')}
      </Link>
    </div>
  );
}
