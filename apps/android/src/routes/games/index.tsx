/**
 * apps/android/src/routes/games/index.tsx
 *
 * Game browser/catalogue. Query key: ['games']. GET /api/games.
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { GameSummary } from '@zobia/shared/types';

async function fetchGames() {
  const { data } = await apiClient.get<GameSummary[]>('/games');
  return data ?? [];
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl p-4 shadow-card animate-pulse">
      <div className="w-12 h-12 rounded-xl bg-neutral-200 mb-3" />
      <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-neutral-100 rounded w-1/2" />
    </div>
  );
}

function GamesPage() {
  const { t } = useTranslation();
  const { data: games, status, refetch } = useQuery({
    queryKey: ['games'],
    queryFn: fetchGames,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      {status === 'pending' && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm"
          >
            {t('android.error.retry')}
          </button>
        </div>
      )}

      {status === 'success' && (
        <div className="grid grid-cols-2 gap-3">
          {games.map((game) => (
            <Link
              key={game.id}
              to="/games/$slug"
              params={{ slug: game.slug }}
              className="bg-white rounded-xl p-4 shadow-card active:scale-95 transition-transform"
            >
              <div className="text-4xl mb-2">{game.coverEmoji}</div>
              <p className="font-semibold text-neutral-900 text-sm truncate">{game.name}</p>
              {game.tagline && (
                <p className="text-neutral-500 text-xs mt-0.5 truncate">{game.tagline}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-neutral-400">⭐ {game.avgRating.toFixed(1)}</span>
                <span className="text-xs text-neutral-400">·</span>
                <span className="text-xs text-neutral-400">{game.playCount.toLocaleString()} plays</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/games/')({
  component: GamesPage,
});
