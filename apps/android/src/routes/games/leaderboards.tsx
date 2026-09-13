/**
 * apps/android/src/routes/games/leaderboards.tsx
 *
 * Cross-game leaderboards hub — mirrors
 * apps/web/app/(app)/games/leaderboards/page.tsx: pick a game, see its top
 * players. Reuses the exact same GET /api/games/:slug/leaderboard endpoint
 * routes/games/$slug/index.tsx already calls for the embedded per-game board
 * — this page is just a game-picker in front of it, same game list card
 * pattern as routes/games/index.tsx.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { GameSummary, GameLeaderboardRow } from '@zobia/shared/types';

async function fetchGames(): Promise<GameSummary[]> {
  const { data } = await apiClient.get<{ games: GameSummary[] }>('/games');
  return data?.games ?? [];
}

async function fetchLeaderboard(slug: string): Promise<GameLeaderboardRow[]> {
  const { data } = await apiClient.get<{ rows: GameLeaderboardRow[]; page: number; pageSize: number }>(
    `/games/${slug}/leaderboard`
  );
  return data?.rows ?? [];
}

function LeaderboardsPage() {
  const { t } = useTranslation();
  const [slug, setSlug] = useState('');

  const { data: games } = useQuery({ queryKey: ['games', 'all'], queryFn: fetchGames, staleTime: 5 * 60_000 });

  useEffect(() => {
    if (!slug && games?.[0]) setSlug(games[0].slug);
  }, [games, slug]);

  const { data: rows, status } = useQuery({
    queryKey: ['games', slug, 'leaderboard'],
    queryFn: () => fetchLeaderboard(slug),
    enabled: !!slug,
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{t('games.leaderboards', 'Leaderboards')}</h1>
        <Link to="/games" className="text-sm text-primary-600 dark:text-primary-300">← {t('games.title', 'Games')}</Link>
      </div>

      <select
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        className="mb-4 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100"
      >
        {(games ?? []).map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
      </select>

      {status === 'pending' && (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-white dark:bg-neutral-800" />)}
        </div>
      )}

      {status === 'success' && rows && rows.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">{t('games.noScores', 'No scores yet. Be the first!')}</p>
      )}

      {status === 'success' && rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800 shadow-card">
          {rows.map((r, i) => (
            <div
              key={r.userId}
              className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-neutral-100 dark:border-neutral-800' : ''}`}
            >
              <span className="w-6 text-right text-sm font-bold text-neutral-400 dark:text-neutral-500">{r.rank}</span>
              <span className="text-xl" aria-hidden>{r.avatarEmoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{r.displayName || r.username}</p>
                <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">@{r.username}</p>
              </div>
              <span className="text-sm font-bold text-primary-600 dark:text-primary-300">{r.bestScore.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/games/leaderboards')({
  component: LeaderboardsPage,
});
