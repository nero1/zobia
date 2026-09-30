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
import { Icon } from '@/components/ui/Icon';
import { HiddenFromOthersTag, RevealButton, useReveal } from '@/components/leaderboard/AnonymousReveal';

type Scope = 'global' | 'city' | 'guild' | 'season';
type Track = 'main' | 'social' | 'creator' | 'competitor' | 'generosity' | 'gaming' | 'knowledge' | 'explorer';
type Plan = 'free' | 'basic' | 'pro' | 'vip';

const SCOPE_ORDER: Scope[] = ['global', 'city', 'guild', 'season'];
const TRACK_ORDER: Track[] = ['main', 'social', 'creator', 'competitor', 'generosity', 'gaming', 'knowledge', 'explorer'];

const PLAN_BADGE: Record<Plan, string> = {
  free: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400',
  basic: 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300',
  pro: 'bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300',
  vip: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
};

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  /** The player hides their name on leaderboards; identity fields then read "Anonymous". */
  anonymous?: boolean;
  /** Real identity — only sent to admins of a sub-leaderboard (e.g. the guild board), behind a "Reveal" control. */
  revealed?: { userId: string; username: string; displayName: string; avatarEmoji: string };
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

function RankMedal({ rank }: { rank: number }) {
  const emoji = rankMedal(rank);
  if (!emoji) return null;
  return <Icon emoji={emoji} size={14} />;
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
    anonymous: e.anonymous === true,
    revealed: e.revealed
      ? {
          userId: (((e.revealed as Record<string, unknown>).user_id ?? (e.revealed as Record<string, unknown>).userId) as string) ?? '',
          username: ((e.revealed as Record<string, unknown>).username as string) ?? '',
          displayName: (((e.revealed as Record<string, unknown>).display_name ?? (e.revealed as Record<string, unknown>).displayName) as string) ?? '',
          avatarEmoji: (((e.revealed as Record<string, unknown>).avatar_emoji ?? (e.revealed as Record<string, unknown>).avatarEmoji) as string) ?? '😊',
        }
      : undefined,
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
  const { t } = useTranslation();
  const reveal = useReveal(entry.revealed);
  const shownIdentity = reveal.shown && entry.revealed ? entry.revealed : entry;
  // Hidden from everyone but the player themself (and admins who reveal).
  const isMaskedRow = Boolean(entry.anonymous) && !entry.isCurrentUser && !reveal.shown;
  const rankChange = entry.rankChange;
  const className = `flex items-center gap-3 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 last:border-0 ${highlight ? 'bg-primary-50 dark:bg-primary-900/30' : ''}`;
  const body = (
    <>
      <div className="flex w-10 shrink-0 items-center gap-0.5 text-sm font-bold tabular-nums text-neutral-700 dark:text-neutral-300">
        <RankMedal rank={entry.rank} />
        <span>{entry.rank}</span>
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-lg">
        {shownIdentity.avatarEmoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {isMaskedRow ? t('leaderboard.anonymous.name', 'Anonymous') : shownIdentity.displayName}
          {entry.anonymous && entry.isCurrentUser && <HiddenFromOthersTag />}
          {reveal.canReveal && <RevealButton shown={reveal.shown} onToggle={reveal.toggle} />}
        </p>
        {!isMaskedRow && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate">@{shownIdentity.username}{entry.city ? ` · ${entry.city}` : ''}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">{entry.xp.toLocaleString()}</p>
        {showPlan && entry.plan && (
          <span className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${PLAN_BADGE[entry.plan]}`}>
            {entry.plan}
          </span>
        )}
        {rankChange !== 0 && (
          <p className={`inline-flex items-center gap-0.5 text-xs font-semibold ${rankChange > 0 ? 'text-success-600 dark:text-success-300' : 'text-danger-500'}`}>
            <Icon emoji={rankChange > 0 ? '▲' : '▼'} size={10} />{Math.abs(rankChange)}
          </p>
        )}
      </div>
    </>
  );
  // A masked row has no profile to open.
  if (isMaskedRow) return <div className={className}>{body}</div>;
  return (
    <Link to="/profile/$username" params={{ username: shownIdentity.username }} className={className}>
      {body}
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
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 px-4 py-4">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mb-3">{t('leaderboards.title')}</h1>

      <div className="flex gap-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 p-1 mb-3">
        {SCOPE_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => changeScope(s)}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold ${scope === s ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-card' : 'text-neutral-500 dark:text-neutral-400'}`}
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
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${track === tr ? 'bg-primary-600 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'}`}
          >
            {t(`leaderboards.track.${tr}`)}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-card mb-3">
        {status === 'pending' && (
          <div className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">{t('common.loading')}</div>
        )}

        {status === 'error' && (
          <div className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">{t('error.generic')}</div>
        )}

        {status === 'success' && data.entries.length === 0 && (
          <div className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">{t('leaderboards.empty')}</div>
        )}

        {status === 'success' && data.entries.length > 0 && (
          <>
            {data.entries.map((e) => (
              <EntryRow key={e.userId} entry={user?.id && e.userId === user.id ? { ...e, isCurrentUser: true } : e} highlight={e.isCurrentUser || (!!user?.id && e.userId === user.id)} showPlan={canSeePlan} />
            ))}
          </>
        )}
      </div>

      {status === 'success' && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-neutral-500 dark:text-neutral-400 mb-3">
          <span>{t('leaderboards.players', { count: data.total })}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              <Icon emoji="←" size={12} /> {t('leaderboards.prevPage')}
            </button>
            <span className="tabular-nums text-xs">{t('leaderboards.page', { page, total: totalPages })}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {t('leaderboards.nextPage')}
            </button>
          </div>
        </div>
      )}

      {currentUser && !isCurrentUserVisible && (
        <div className="sticky bottom-4 rounded-xl border border-primary-300 bg-primary-50 dark:bg-primary-900/30 px-3 py-2 shadow-modal">
          <p className="mb-1.5 text-xs font-semibold text-primary-600 dark:text-primary-300">{t('leaderboards.yourPosition')}</p>
          <EntryRow entry={currentUser} highlight showPlan={canSeePlan} />
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/leaderboards')({
  component: LeaderboardsPage,
});
