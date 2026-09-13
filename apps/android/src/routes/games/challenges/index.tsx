/**
 * apps/android/src/routes/games/challenges/index.tsx
 *
 * Challenge inbox — mirrors apps/web/app/(app)/games/challenges/page.tsx:
 * send a challenge to another user (search-as-you-type, same debounced
 * pattern as routes/gifts.tsx), best-of-1/best-of-3 format, an optional
 * Credit wager, and accept/decline/cancel/delete/archive on existing
 * challenges. Reuses the exact same endpoints web calls:
 *   GET/POST   /api/games/challenges
 *   GET/DELETE/PATCH /api/games/challenges/:id
 *   POST /api/games/challenges/:id/{accept,decline,cancel}
 *
 * Challenges expire after the manifest's `challengeExpiryHours` (default 720)
 * if the opponent never responds — same expiry cron as web (see
 * docs/HOW-IT-WORKS.md), so the countdown here is read-only, cosmetic.
 */

import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import type { GameSummary, GameChallengeSummary } from '@zobia/shared/types';

interface ChallengesPage {
  challenges: GameChallengeSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface UserSuggestion {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

async function fetchGames(): Promise<GameSummary[]> {
  const { data } = await apiClient.get<{ games: GameSummary[] }>('/games');
  return data?.games ?? [];
}

async function fetchChallenges(): Promise<GameChallengeSummary[]> {
  const { data } = await apiClient.get<ChallengesPage>('/games/challenges');
  return data?.challenges ?? [];
}

async function searchOpponents(q: string): Promise<UserSuggestion[]> {
  const { data } = await apiClient.get<{ users: UserSuggestion[] }>(
    `/users/search?q=${encodeURIComponent(q)}&limit=6`
  );
  return data?.users ?? [];
}

/** Countdown to a challenge's expiresAt (mirrors web's useCountdown on this same page). */
function useCountdown(isoTarget: string): { label: string; urgent: boolean } {
  const [secs, setSecs] = useState(() => Math.max(0, Math.floor((new Date(isoTarget).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const timer = setInterval(
      () => setSecs(Math.max(0, Math.floor((new Date(isoTarget).getTime() - Date.now()) / 1000))),
      60_000
    );
    return () => clearInterval(timer);
  }, [isoTarget]);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const label = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return { label, urgent: secs < 86400 };
}

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const { t } = useTranslation();
  const { label, urgent } = useCountdown(expiresAt);
  return (
    <span className={`text-xs font-medium ${urgent ? 'text-red-500' : 'text-neutral-400 dark:text-neutral-500'}`}>
      ⏳ {t('games.challenges.expiresIn', 'Expires in {{time}}', { time: label })}
    </span>
  );
}

/** Wager badge — kept visually distinct (gold) everywhere a stake is at play,
 * so the amount a tap commits to is always visible before it's tapped. */
function WagerBadge({ amount }: { amount: number }) {
  const { t } = useTranslation();
  if (amount <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold-50 dark:bg-gold-900/30 px-2 py-0.5 text-xs font-bold text-gold-700 dark:text-gold-300">
      🪙 {amount.toLocaleString()} {t('games.credits', 'credits')}
    </span>
  );
}

function NewChallengeForm({ games, onCreated }: { games: GameSummary[]; onCreated: () => void }) {
  const { t } = useTranslation();
  const [gameSlug, setGameSlug] = useState('');
  const [rounds, setRounds] = useState<1 | 3>(1);
  const [wagerCredits, setWagerCredits] = useState(0);
  const [opponentQuery, setOpponentQuery] = useState('');
  const [opponentSuggestions, setOpponentSuggestions] = useState<UserSuggestion[]>([]);
  const [opponentSelected, setOpponentSelected] = useState<UserSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameSlug && games[0]) setGameSlug(games[0].slug);
  }, [games, gameSlug]);

  // Debounced opponent search (300ms — same as gifts.tsx's recipient search).
  useEffect(() => {
    if (opponentSelected && opponentQuery === opponentSelected.username) return;
    setOpponentSelected(null);
    if (opponentQuery.trim().length < 2) { setOpponentSuggestions([]); return; }
    const id = setTimeout(() => {
      searchOpponents(opponentQuery.trim()).then(setOpponentSuggestions).catch(() => setOpponentSuggestions([]));
    }, 300);
    return () => clearTimeout(id);
  }, [opponentQuery, opponentSelected]);

  const create = useMutation({
    mutationFn: () =>
      apiClient.post('/games/challenges', {
        gameSlug,
        opponentUsername: opponentSelected?.username,
        rounds,
        wagerCredits,
      }),
    onSuccess: () => {
      setOpponentQuery('');
      setOpponentSelected(null);
      setWagerCredits(0);
      onCreated();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? t('error.generic'));
    },
  });

  function pickOpponent(u: UserSuggestion) {
    setOpponentSelected(u);
    setOpponentQuery(u.username);
    setOpponentSuggestions([]);
  }

  function submit() {
    setError(null);
    if (!opponentSelected) {
      setError(t('games.challenges.pickOpponent', 'Pick an opponent from the suggestions.'));
      return;
    }
    create.mutate();
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
      <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{t('games.newChallenge', 'New challenge')}</h2>

      <select
        value={gameSlug}
        onChange={(e) => setGameSlug(e.target.value)}
        className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
      >
        {games.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
      </select>

      <div className="relative">
        <input
          value={opponentQuery}
          onChange={(e) => setOpponentQuery(e.target.value)}
          placeholder={t('games.opponentUsername', 'Opponent username')}
          autoComplete="off"
          className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
        />
        {opponentSelected && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-success-600 dark:text-success-300">
            ✓ {opponentSelected.displayName}
          </span>
        )}
        {!opponentSelected && opponentSuggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-card">
            {opponentSuggestions.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => pickOpponent(u)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm active:bg-neutral-50 dark:active:bg-neutral-800"
              >
                <span className="text-lg">{u.avatarEmoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-neutral-900 dark:text-neutral-100">{u.displayName}</span>
                  <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">@{u.username}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <select
          value={rounds}
          onChange={(e) => setRounds(Number(e.target.value) as 1 | 3)}
          className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
        >
          <option value={1}>{t('games.bestOf1', 'Best of 1')}</option>
          <option value={3}>{t('games.bestOf3', 'Best of 3')}</option>
        </select>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={wagerCredits}
          onChange={(e) => setWagerCredits(Math.max(0, Number(e.target.value) || 0))}
          placeholder={t('games.wager', 'wager')}
          className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
        />
      </div>

      {/* Stake shown clearly, before the user commits, same as the wager input
          itself on web — this app additionally renders it as a coloured badge
          so it can't be missed on a small screen. */}
      {wagerCredits > 0 && (
        <div className="rounded-lg bg-gold-50 dark:bg-gold-900/30 px-3 py-2 text-xs font-semibold text-gold-700 dark:text-gold-300">
          {t('games.challenges.stakeNotice', 'Both players will stake {{amount}} credits once accepted.', { amount: wagerCredits })}
        </div>
      )}

      <button
        type="button"
        disabled={create.isPending}
        onClick={submit}
        className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {t('games.sendChallenge', 'Send challenge')}
      </button>
      {error && <p className="text-xs text-amber-600 dark:text-amber-300">{error}</p>}
    </div>
  );
}

function ChallengeCard({ c, me }: { c: GameChallengeSummary; me: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const incoming = c.opponentId === me;
  const isChallenger = c.challengerId === me;
  const canDelete = isChallenger && c.status === 'pending';
  const canArchive = c.status === 'completed';

  const invalidate = () => qc.invalidateQueries({ queryKey: ['games', 'challenges'] });

  const act = useMutation({
    mutationFn: (action: 'accept' | 'decline' | 'cancel') => apiClient.post(`/games/challenges/${c.id}/${action}`),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => apiClient.delete(`/games/challenges/${c.id}`),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: () => apiClient.patch(`/games/challenges/${c.id}`, { action: 'archive' }),
    onSuccess: invalidate,
  });

  const busy = act.isPending || remove.isPending || archive.isPending;

  return (
    <div className="rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">{c.gameName}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {incoming ? `${t('games.from', 'from')} @${c.challengerUsername}` : `${t('games.to', 'to')} @${c.opponentUsername}`}
            {' · '}{c.rounds === 1 ? t('games.bestOf1', 'Best of 1') : t('games.bestOf3', 'Best of 3')}
          </p>
        </div>
        <span className="flex-shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-1 text-[10px] font-semibold text-neutral-600 dark:text-neutral-400">
          {t(`games.status.${c.status}`, c.status)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <WagerBadge amount={c.wagerCredits} />
        {(c.status === 'pending' || c.status === 'active') && <ExpiryCountdown expiresAt={c.expiresAt} />}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {incoming && c.status === 'pending' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act.mutate('accept')}
              className="rounded-lg bg-success-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t('games.accept', 'Accept')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act.mutate('decline')}
              className="rounded-lg bg-neutral-200 dark:bg-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-50"
            >
              {t('games.decline', 'Decline')}
            </button>
          </>
        )}
        {!incoming && (c.status === 'pending' || c.status === 'active') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act.mutate('cancel')}
            className="rounded-lg bg-neutral-200 dark:bg-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-50"
          >
            {t('games.cancel', 'Cancel')}
          </button>
        )}
        {c.status === 'active' && (
          <Link
            to="/games/challenges/$id"
            params={{ id: c.id }}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {t('games.playRound', 'Play your round')}
          </Link>
        )}
        {c.status === 'completed' && (
          <span className="text-xs font-semibold text-success-600 dark:text-success-300">
            {c.winnerId === me ? t('games.youWon', 'You won! 🏆') : c.winnerId ? t('games.youLost', 'You lost') : t('games.draw', 'Draw')}
          </span>
        )}
        {canDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => remove.mutate()}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-300 disabled:opacity-50"
          >
            🗑 {t('games.challenges.delete', 'Delete')}
          </button>
        )}
        {canArchive && (
          <button
            type="button"
            disabled={busy}
            onClick={() => archive.mutate()}
            className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400 disabled:opacity-50"
          >
            🗄 {t('games.challenges.archive', 'Archive')}
          </button>
        )}
      </div>
    </div>
  );
}

function ChallengesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = useState('');

  const { data: games } = useQuery({ queryKey: ['games', 'all'], queryFn: fetchGames, staleTime: 5 * 60_000 });
  const { data: challenges, status } = useQuery({ queryKey: ['games', 'challenges'], queryFn: fetchChallenges });

  const filtered = useMemo(() => {
    const list = challenges ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.gameName.toLowerCase().includes(q) ||
        c.challengerUsername.toLowerCase().includes(q) ||
        c.opponentUsername.toLowerCase().includes(q)
    );
  }, [challenges, search]);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{t('games.challenges', 'Challenges')}</h1>
        <Link to="/games" className="text-sm text-primary-600 dark:text-primary-300">← {t('games.title', 'Games')}</Link>
      </div>

      <NewChallengeForm games={games ?? []} onCreated={() => undefined} />

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('games.challenges.search.placeholder', 'Search by game or player…')}
        className="mb-3 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
      />

      {status === 'pending' && (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-white dark:bg-neutral-800" />)}
        </div>
      )}

      {status === 'success' && filtered.length === 0 && (
        <p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {(challenges ?? []).length === 0 ? t('games.noChallenges', 'No challenges yet.') : t('games.challenges.noResults', 'No challenges match your search.')}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((c) => <ChallengeCard key={c.id} c={c} me={user?.id ?? null} />)}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/games/challenges/')({
  component: ChallengesPage,
});
