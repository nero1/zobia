/**
 * apps/android/src/routes/games/challenges/$id.tsx
 *
 * Challenge detail — mirrors apps/web/app/(app)/games/challenges/[id]/page.tsx:
 * round-by-round score breakdown plus a "Play your round" action. Unlike web
 * (which mounts <GameRunner> inline), this hands off to the same embedded
 * iframe player routes/games/$slug/play.tsx already uses for normal play —
 * passing `?c=<challengeId>` so the embed's GameRunner binds the play session
 * to this challenge round (see apps/web/components/games/GameRunner.tsx's
 * `challengeId` prop / apps/web/app/g/[slug]/embed/page.tsx's `?c=` param),
 * and returns here (not the game's own page) on exit.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface RoundDetail {
  round_no: number;
  challenger_score: number | null;
  opponent_score: number | null;
  round_winner_id: string | null;
  status: string;
}

interface ChallengeDetail {
  id: string;
  gameSlug: string;
  gameName: string;
  status: string;
  rounds: number;
  wagerCredits: number;
  winnerId: string | null;
  challengerUsername: string;
  opponentUsername: string;
  rounds_detail: RoundDetail[];
}

async function fetchDetail(id: string): Promise<ChallengeDetail | null> {
  const { data } = await apiClient.get<{ challenge: ChallengeDetail }>(`/games/challenges/${id}`);
  return data?.challenge ?? null;
}

function ChallengeDetailPage() {
  const { t } = useTranslation();
  const { id } = Route.useParams();

  const { data: detail, status } = useQuery({
    queryKey: ['games', 'challenges', id],
    queryFn: () => fetchDetail(id),
  });

  if (status === 'pending') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (status === 'error' || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-neutral-500">{t('error.generic')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <Link to="/games/challenges" className="text-sm text-primary-600">← {t('games.challenges', 'Challenges')}</Link>
      <h1 className="mt-2 text-lg font-bold text-neutral-900">{detail.gameName}</h1>
      <p className="mt-0.5 text-sm text-neutral-500">
        @{detail.challengerUsername} vs @{detail.opponentUsername}
      </p>
      {detail.wagerCredits > 0 && (
        <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-gold-50 px-3 py-1 text-xs font-bold text-gold-700">
          🪙 {detail.wagerCredits.toLocaleString()} {t('games.credits', 'credits')} {t('games.wager', 'wager')}
        </div>
      )}

      <div className="my-4 flex flex-col gap-2">
        {detail.rounds_detail.map((r) => (
          <div key={r.round_no} className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-card">
            <span className="text-sm font-medium text-neutral-700">{t('games.round', 'Round')} {r.round_no}</span>
            <span className="text-sm font-bold text-neutral-900">
              {r.challenger_score ?? '—'} : {r.opponent_score ?? '—'}
            </span>
          </div>
        ))}
      </div>

      {detail.status === 'active' && (
        <Link
          to="/games/$slug/play"
          params={{ slug: detail.gameSlug }}
          search={{ c: detail.id }}
          className="block w-full rounded-lg bg-primary-600 py-3 text-center text-sm font-semibold text-white"
        >
          {t('games.playRound', 'Play your round')}
        </Link>
      )}

      {detail.status === 'completed' && (
        <p className="mt-4 text-center text-sm font-semibold text-success-600">
          {detail.winnerId ? t('games.challengeOver', 'Challenge complete') : t('games.draw', 'Draw')}
        </p>
      )}
    </div>
  );
}

export const Route = createFileRoute('/games/challenges/$id')({
  component: ChallengeDetailPage,
});
