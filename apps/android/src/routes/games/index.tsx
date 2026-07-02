/**
 * apps/android/src/routes/games/index.tsx
 *
 * Game browser/catalogue. Query key: ['games', search]. GET /api/games.
 *
 * Mirrors the web/PWA discovery page's search bar and heart-favorite toggle
 * (/api/games/favorites — same endpoint the web Faves tab uses). The fuller
 * tab/view-toggle UI (Popular/Trending/New/Faves/Random/Recent) stays
 * web/PWA-only, same convention as the rooms list on this app.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { GameSummary } from '@zobia/shared/types';

async function fetchGames(q: string) {
  const params = q.trim() ? `?tab=popular&q=${encodeURIComponent(q.trim())}` : '';
  const { data } = await apiClient.get<{ games: GameSummary[] }>(`/games${params}`);
  return data?.games ?? [];
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
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const { data: games, status, refetch } = useQuery({
    queryKey: ['games', search],
    queryFn: () => fetchGames(search),
    staleTime: 5 * 60_000,
  });

  // Favorite (heart) toggle — reuses /api/games/favorites (same endpoint the
  // web Faves tab uses).
  const toggleFavorite = useMutation({
    mutationFn: ({ gameId, next }: { gameId: string; next: boolean }) =>
      next
        ? apiClient.post('/games/favorites', { gameId })
        : apiClient.delete('/games/favorites', { data: { gameId } }),
    onMutate: ({ gameId, next }) => {
      qc.setQueryData<GameSummary[]>(['games', search], (prev = []) =>
        prev.map((g) => (g.id === gameId ? { ...g, isFavorited: next } : g))
      );
    },
    onError: (_err, { gameId, next }) => {
      qc.setQueryData<GameSummary[]>(['games', search], (prev = []) =>
        prev.map((g) => (g.id === gameId ? { ...g, isFavorited: !next } : g))
      );
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('games.search.placeholder', 'Search games…')}
        className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 mb-4 focus:border-primary-500 focus:outline-none"
      />

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

      {status === 'success' && games.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <p className="text-neutral-500 text-sm">{t('games.empty.filter', 'No games found for this filter.')}</p>
        </div>
      )}

      {status === 'success' && games.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {games.map((game) => (
            <div key={game.id} className="relative bg-white rounded-xl shadow-card active:scale-95 transition-transform">
              <Link to="/games/$slug" params={{ slug: game.slug }} className="block p-4 pr-9">
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
                {game.favoriteCount > 0 && (
                  <span className="text-xs text-rose-500 mt-1 block">❤️ {game.favoriteCount.toLocaleString()}</span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => toggleFavorite.mutate({ gameId: game.id, next: !game.isFavorited })}
                aria-label={game.isFavorited ? t('games.removeFavorite', 'Remove favorite') : t('games.addFavorite', 'Add favorite')}
                className="absolute right-3 top-3 text-lg"
              >
                {game.isFavorited ? '❤️' : '🤍'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/games/')({
  component: GamesPage,
});
