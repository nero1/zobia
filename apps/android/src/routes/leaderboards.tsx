/**
 * apps/android/src/routes/leaderboards.tsx
 *
 * Leaderboards screen — mirrors apps/web/app/(app)/leaderboards/page.tsx:
 * scope tabs (Global/City/Guild/Season), track filter chips, a ranked table,
 * and a "Your Position" sticky callout. GET /leaderboards returns
 * { entries, total, userRank }; the calling user's row (`currentUserEntry`)
 * is not populated by the backend today, same as the web page — the sticky
 * footer is dead code there too, kept here for parity.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

type Scope = 'global' | 'city' | 'guild' | 'season';
type Track = 'main' | 'social' | 'creator' | 'competitor' | 'generosity' | 'gaming' | 'knowledge' | 'explorer';
type Plan = 'free' | 'basic' | 'pro' | 'vip';

const SCOPE_ORDER: Scope[] = ['global', 'city', 'guild', 'season'];
const TRACK_ORDER: Track[] = ['main', 'social', 'creator', 'competitor', 'generosity', 'gaming', 'knowledge', 'explorer'];

const PLAN_BADGE: Record<Plan, string> = {
  free: 'bg-neutral-100 text-neutral-600',
  basic: 'bg-primary-100 text-primary-700',
  pro: 'bg-success-100 text-success-700',
  vip: 'bg-amber-100 text-amber-700',
};

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  city: string;
  xp: number;
  plan: Plan | null;
  isCurrentUser: boolean;
  rankChange: number;
}

interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  currentUserEntry: LeaderboardEntry | null;
  userRank: number | null;
}

const PAGE_SIZE = 20;

function rankMedal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

async function fetchLeaderboard(scope: Scope, track: Track, page: number): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ scope, track, page: String(page), limit: String(PAGE_SIZE) });
  const { data: apiData } = await apiClient.get<Record<string, unknown>>(`/leaderboards?${params.toString()}`);
  const rawEntries = (apiData.entries as Record<string, unknown>[]) ?? [];
  const entries: LeaderboardEntry[] = rawEntries.map((e) => ({
    rank: (e.rank as number) ?? 0,
    userId: ((e.user_id ?? e.userId) as string) ?? '',
    username: (e.username as string) ?? '',
    displayName: ((e.display_name ?? e.displayName) as string) ?? '',
    avatarEmoji: ((e.avatar_emoji ?? e.avatarEmoji) as string) ?? '😊',
    city: (e.city as string) ?? '',
    xp: ((e.xp_value ?? e.xp) as number) ?? 0,
    plan: (e.plan as Plan | undefined) ?? null,
    isCurrentUser: false,
    rankChange: (e.rankChange as number) ?? (e.rank_change as number) ?? 0,
  }));
  return {
    entries,
    total: (apiData.total as number) ?? 0,
    currentUserEntry: null,
    userRank: (apiData.userRank as number) ?? null,
  };
}

function EntryRow({ entry, highlight, showPlan }: { entry: LeaderboardEntry; highlight?: boolean; showPlan: boolean }) {
  const rankChange = entry.rankChange;
  return (
    <Link
      to="/profile/$username"
      params={{ username: entry.username }}
      className={`flex items-center gap-3 px-4 py-3 border-b border-neutral-100 last:border-0 ${highlight ? 'bg-primary-50' : ''}`}
    >
      <div className="flex w-10 shrink-0 items-center gap-0.5 text-sm font-bold tabular-nums text-neutral-700">
        <span>{rankMedal(entry.rank)}</span>
        <span>{entry.rank}</span>
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-lg">
        {entry.avatarEmoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-900 truncate">{entry.displayName}</p>
        <p className="text-xs text-neutral-400 truncate">@{entry.username}{entry.city ? ` · ${entry.city}` : ''}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-neutral-800">{entry.xp.toLocaleString()}</p>
        {showPlan && entry.plan && (
          <span className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${PLAN_BADGE[entry.plan]}`}>
            {entry.plan}
          </span>
        )}
        {rankChange !== 0 && (
          <p className={`text-xs font-semibold ${rankChange > 0 ? 'text-success-600' : 'text-danger-500'}`}>
            {rankChange > 0 ? `▲${rankChange}` : `▼${Math.abs(rankChange)}`}
          </p>
        )}
      </div>
    </Link>
  );
}

function LeaderboardsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canSeePlan = Boolean(user?.is_admin);
  const [scope, setScope] = useState<Scope>('global');
  const [track, setTrack] = useState<Track>('main');
  const [page, setPage] = useState(1);

  const { data, status } = useQuery({
    queryKey: ['leaderboards', scope, track, page],
    queryFn: () => fetchLeaderboard(scope, track, page),
  });

  function changeScope(s: Scope) {
    setScope(s);
    setPage(1);
  }

  function changeTrack(tr: Track) {
    setTrack(tr);
    setPage(1);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentUser = data?.currentUserEntry;
  const isCurrentUserVisible = currentUser == null || (data?.entries ?? []).some((e) => e.isCurrentUser);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-xl font-bold text-neutral-900 mb-3">{t('leaderboards.title')}</h1>

      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 mb-3">
        {SCOPE_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => changeScope(s)}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold ${scope === s ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}
          >
            {t(`leaderboards.scope.${s}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {TRACK_ORDER.map((tr) => (
          <button
            key={tr}
            onClick={() => changeTrack(tr)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${track === tr ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-700'}`}
          >
            {t(`leaderboards.track.${tr}`)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-card mb-3">
        {status === 'pending' && (
          <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading', 'Loading…')}</div>
        )}

        {status === 'error' && (
          <div className="py-8 text-center text-sm text-neutral-500">{t('error.generic')}</div>
        )}

        {status === 'success' && data.entries.length === 0 && (
          <div className="py-8 text-center text-sm text-neutral-500">{t('leaderboards.empty')}</div>
        )}

        {status === 'success' && data.entries.length > 0 && (
          <>
            {data.entries.map((e) => (
              <EntryRow key={e.userId} entry={e} highlight={e.isCurrentUser} showPlan={canSeePlan} />
            ))}
          </>
        )}
      </div>

      {status === 'success' && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-neutral-500 mb-3">
          <span>{t('leaderboards.players', { count: data.total })}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {t('leaderboards.prevPage')}
            </button>
            <span className="tabular-nums text-xs">{t('leaderboards.page', { page, total: totalPages })}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {t('leaderboards.nextPage')}
            </button>
          </div>
        </div>
      )}

      {currentUser && !isCurrentUserVisible && (
        <div className="sticky bottom-4 rounded-xl border border-primary-300 bg-primary-50 px-3 py-2 shadow-modal">
          <p className="mb-1.5 text-xs font-semibold text-primary-600">{t('leaderboards.yourPosition')}</p>
          <EntryRow entry={currentUser} highlight showPlan={canSeePlan} />
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/leaderboards')({
  component: LeaderboardsPage,
});
