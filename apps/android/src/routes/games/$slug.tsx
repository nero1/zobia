/**
 * apps/android/src/routes/games/$slug.tsx
 *
 * Individual game view. GET /api/games/:slug + /api/games/:slug/leaderboard.
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { GameSummary, GameLeaderboardRow } from '@zobia/shared/types';

async function fetchGame(slug: string) {
  const { data } = await apiClient.get<GameSummary>(`/games/${slug}`);
  return data;
}

async function fetchLeaderboard(slug: string) {
  const { data } = await apiClient.get<GameLeaderboardRow[]>(`/games/${slug}/leaderboard?limit=10`);
  return data ?? [];
}

function GameDetailPage() {
  const { t } = useTranslation();
  const { slug } = Route.useParams();

  const { data: game, status } = useQuery({
    queryKey: ['games', slug],
    queryFn: () => fetchGame(slug),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['games', slug, 'leaderboard'],
    queryFn: () => fetchLeaderboard(slug),
    enabled: !!game,
  });

  if (status === 'pending') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'error' || !game) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      {/* Hero */}
      <div className="bg-white px-6 pt-6 pb-4">
        <div className="flex items-center gap-4 mb-4">
          <div className="text-6xl">{game.coverEmoji}</div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-neutral-900">{game.name}</h2>
            {game.tagline && <p className="text-neutral-500 text-sm mt-0.5">{game.tagline}</p>}
            <div className="flex items-center gap-3 mt-2 text-xs text-neutral-400">
              <span>⭐ {game.avgRating.toFixed(1)} ({game.ratingCount.toLocaleString()})</span>
              <span>·</span>
              <span>{game.playCount.toLocaleString()} plays</span>
            </div>
          </div>
        </div>

        {game.description && (
          <p className="text-neutral-700 text-sm leading-relaxed mb-4">{game.description}</p>
        )}

        <button className="w-full py-3 bg-primary-600 text-white font-semibold rounded-lg">
          {t('android.games.play')}
        </button>
      </div>

      {/* Rewards */}
      <div className="bg-white mt-3 px-6 py-4">
        <div className="flex items-center gap-6 text-center">
          <div className="flex-1">
            <p className="text-lg font-bold text-gold-600">🪙 {game.rewardCreditsPerWin}</p>
            <p className="text-xs text-neutral-500">Credits/win</p>
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-primary-600">+{game.rewardXpPerWin} XP</p>
            <p className="text-xs text-neutral-500">XP/win</p>
          </div>
          {game.playCostCredits > 0 && (
            <div className="flex-1">
              <p className="text-lg font-bold text-neutral-700">🪙 {game.playCostCredits}</p>
              <p className="text-xs text-neutral-500">Cost/play</p>
            </div>
          )}
        </div>
      </div>

      {/* Leaderboard */}
      {leaderboard && leaderboard.length > 0 && (
        <div className="bg-white mt-3 px-6 py-4">
          <h3 className="font-semibold text-neutral-900 mb-3">{t('android.games.topScores')}</h3>
          <div className="space-y-3">
            {leaderboard.map((row) => (
              <div key={row.userId} className="flex items-center gap-3">
                <span className="text-sm font-bold text-neutral-400 w-5 text-right">#{row.rank}</span>
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-sm">
                  {row.avatarEmoji}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-neutral-900">{row.displayName}</p>
                  <p className="text-xs text-neutral-400">@{row.username}</p>
                </div>
                <span className="text-sm font-semibold text-primary-600">{row.bestScore.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/games/$slug')({
  component: GameDetailPage,
});
