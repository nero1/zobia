/**
 * apps/android/src/routes/seasons.tsx
 *
 * Seasons page — mirrors apps/web/app/(app)/seasons/page.tsx: active season
 * hero with days-left progress, season pass status/upgrade, top-10
 * leaderboard, and season history grid.
 *
 * CONTRACT NOTE (see report): the web page's SeasonPassData assumed GET
 * /api/seasons/:id/pass returns { milestones, currentXp, hasPaidPass }, but
 * the actual handler (app/api/seasons/[seasonId]/pass/route.ts) returns
 * { pass: { is_paid, season_xp, ... }, season }. There is no bulk
 * milestones-list endpoint (only a per-milestone GET/POST claim route), so
 * the milestone reward track can't be rendered without a new backend
 * endpoint — out of scope for a targeted fix. This page uses the real
 * pass/season shape and omits the milestone track (flagged in report).
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface SeasonRow {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
}

interface SeasonsResponse {
  current: SeasonRow | null;
  past: SeasonRow[];
}

interface SeasonPassRow {
  id: string;
  is_paid: boolean;
  season_xp: number;
  season_rank: number | null;
  purchased_at: string | null;
}

interface SeasonPassResponse {
  pass: SeasonPassRow;
  season: SeasonRow;
}

interface LeaderEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  seasonXP: number;
}

interface LeaderboardResponse {
  entries: LeaderEntry[];
}

async function fetchSeasons(): Promise<SeasonsResponse> {
  const { data } = await apiClient.get<SeasonsResponse>('/seasons');
  return data;
}

async function fetchPass(seasonId: string): Promise<SeasonPassResponse> {
  const { data } = await apiClient.get<SeasonPassResponse>(`/seasons/${seasonId}/pass`);
  return data;
}

async function fetchLeaderboard(seasonId: string): Promise<LeaderEntry[]> {
  const { data } = await apiClient.get<LeaderboardResponse>(`/seasons/${seasonId}/leaderboard?limit=10`);
  return data?.entries ?? [];
}

function daysRemaining(endAt: string): number {
  return Math.max(0, Math.ceil((new Date(endAt).getTime() - Date.now()) / 86_400_000));
}

function totalDays(startAt: string, endAt: string): number {
  return Math.max(1, Math.ceil((new Date(endAt).getTime() - new Date(startAt).getTime()) / 86_400_000));
}

function SeasonsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, status } = useQuery({ queryKey: ['seasons'], queryFn: fetchSeasons });
  const season = data?.current ?? null;

  const { data: passData } = useQuery({
    queryKey: ['seasons', season?.id, 'pass'],
    queryFn: () => fetchPass(season!.id),
    enabled: !!season,
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['seasons', season?.id, 'leaderboard'],
    queryFn: () => fetchLeaderboard(season!.id),
    enabled: !!season,
  });

  const upgradeMutation = useMutation({
    mutationFn: async () => { await apiClient.post(`/seasons/${season!.id}/pass`); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seasons', season?.id, 'pass'] }),
  });

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="h-40 animate-pulse rounded-xl bg-neutral-200" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <h1 className="text-xl font-bold text-neutral-900">{t('seasons.title', 'Seasons')}</h1>

      {season ? (
        <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                {t('seasons.activeSeason', 'Active Season')}
              </span>
              <h2 className="mt-2 text-lg font-bold text-neutral-900">{season.name}</h2>
              <p className="text-sm text-neutral-500">{season.theme}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-primary-600">{daysRemaining(season.ends_at)}</p>
              <p className="text-xs text-neutral-500">{t('seasons.daysLeft', 'days left')}</p>
            </div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full bg-primary-500"
              style={{
                width: `${Math.min(100, Math.round(((totalDays(season.starts_at, season.ends_at) - daysRemaining(season.ends_at)) / totalDays(season.starts_at, season.ends_at)) * 100))}%`,
              }}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
          <p className="text-neutral-500">{t('seasons.noActiveSeason', 'No active season right now. Check back soon!')}</p>
        </div>
      )}

      {season && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('seasons.seasonPass', 'Season Pass')}</h2>
              {passData?.pass.is_paid ? (
                <span className="mt-1 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  {t('seasons.paidPass', 'Paid Pass')} ⭐
                </span>
              ) : (
                <span className="mt-1 inline-block rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-600">
                  {t('seasons.freePass', 'Free Pass')}
                </span>
              )}
            </div>
            {!passData?.pass.is_paid && (
              <button
                onClick={() => upgradeMutation.mutate()}
                disabled={upgradeMutation.isPending}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {upgradeMutation.isPending
                  ? t('seasons.upgrading', 'Processing…')
                  : `🪙 ${season.pass_price_coins.toLocaleString()}`}
              </button>
            )}
          </div>

          {passData && (
            <p className="mt-3 text-xs text-neutral-400">
              {t('seasons.yourXp', 'Your XP')}: {passData.pass.season_xp.toLocaleString()}
              {passData.pass.season_rank && ` · ${t('seasons.rank', 'Rank')} #${passData.pass.season_rank}`}
            </p>
          )}
        </div>
      )}

      {leaderboard && leaderboard.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
          <div className="border-b border-neutral-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-neutral-700">{t('seasons.seasonTop10', 'Season Top 10')}</h2>
          </div>
          <div className="divide-y divide-neutral-100">
            {leaderboard.map((entry) => (
              <div key={entry.userId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-6 shrink-0 text-center text-xs font-bold text-neutral-500">
                  {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                </span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sm">{entry.avatarEmoji}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">@{entry.username}</span>
                <span className="shrink-0 text-sm font-semibold text-neutral-700">{entry.seasonXP.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-neutral-100 px-4 py-3">
            <Link to="/leaderboards" className="text-sm font-semibold text-primary-600">
              {t('seasons.viewFullLeaderboard', 'View full leaderboard →')}
            </Link>
          </div>
        </div>
      )}

      {data && data.past.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('seasons.seasonHistory', 'Season History')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {data.past.map((s) => (
              <div key={s.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-xs text-neutral-400">{new Date(s.ends_at).getFullYear()}</p>
                <p className="mt-0.5 truncate text-sm font-bold text-neutral-900">{s.name}</p>
                <p className="text-xs text-neutral-500">{s.theme}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/seasons')({
  component: SeasonsPage,
});
