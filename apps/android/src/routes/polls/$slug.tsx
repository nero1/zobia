/**
 * apps/android/src/routes/polls/$slug.tsx
 *
 * Poll detail / vote screen — mirrors apps/web/app/(app)/polls/[slug]/page.tsx:
 * shows options (radio when single-select, checkboxes when allowMultiple),
 * result bars once the viewer has voted, share, and — for the poll owner —
 * a simple "fund reward pot" action.
 *
 * GET /api/polls/[slug], POST .../vote, POST .../share,
 * GET/POST .../treasury, PATCH/DELETE /api/polls/[slug] (owner/mod).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { universalLink, PUBLIC_PATHS } from '@/lib/deeplinks/routes';

interface PollOption {
  id: string;
  label: string;
  voteCount: number;
}

interface PollDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  allowMultiple: boolean;
  status: 'active' | 'closed' | 'disabled';
  closesAt: string | null;
  viewCount: number;
  voterCount: number;
  shareCount: number;
  createdAt: string;
  creatorId: string;
  creatorUsername: string | null;
  creatorAvatarUrl: string | null;
  options: PollOption[];
  myVoteOptionIds: string[];
  isOwner: boolean;
}

interface Treasury {
  id: string;
  fundedAmount: number;
  remainingAmount: number;
  maxClaimants: number;
  claimantCount: number;
  status: string;
  rewardPerClaimant: number;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function FundTreasuryModal({
  onClose,
  onSave,
  saving,
}: {
  onClose: () => void;
  onSave: (amount: number, maxClaimants: number) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [amount, setAmount] = useState('');
  const [maxClaimants, setMaxClaimants] = useState('');
  const canSave = Number(amount) > 0 && Number(maxClaimants) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-bold text-neutral-900">{t('polls.treasury.title', 'Fund Reward Pot')}</p>
        <p className="mt-1 text-sm text-neutral-500">{t('polls.treasury.desc', 'Reward voters from a shared pot, split evenly among claimants.')}</p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('polls.treasury.amount', 'Total Amount ({{currency}})', { currency: currency.softPlural })}</span>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('polls.treasury.maxClaimants', 'Max Claimants')}</span>
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={maxClaimants}
            onChange={(e) => setMaxClaimants(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
          />
        </label>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('answers.ask.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !canSave}
            onClick={() => onSave(Number(amount), Number(maxClaimants))}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '…' : t('polls.treasury.fund', 'Fund')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PollDetailPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const currency = useCurrency();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<string[]>([]);
  const [shareCopied, setShareCopied] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rewardMessage, setRewardMessage] = useState<string | null>(null);

  const pollQuery = useQuery({
    queryKey: ['polls', 'detail', slug],
    queryFn: async () => (await apiClient.get<PollDetail>(`/polls/${slug}`)).data,
  });

  const treasuryQuery = useQuery({
    queryKey: ['polls', 'treasury', slug],
    queryFn: async () => (await apiClient.get<Treasury | null>(`/polls/${slug}/treasury`)).data,
    enabled: !!pollQuery.data,
  });

  const poll = pollQuery.data;
  const hasVoted = (poll?.myVoteOptionIds.length ?? 0) > 0;
  const totalVotes = poll?.options.reduce((sum, o) => sum + o.voteCount, 0) ?? 0;

  const vote = useMutation({
    mutationFn: (optionIds: string[]) => apiClient.post<{ options: PollOption[]; voterCount: number; rewardClaimed: number | null }>(`/polls/${slug}/vote`, { optionIds }),
    onSuccess: (res) => {
      qc.setQueryData<PollDetail>(['polls', 'detail', slug], (prev) =>
        prev ? { ...prev, options: res.data?.options ?? prev.options, voterCount: res.data?.voterCount ?? prev.voterCount, myVoteOptionIds: selected } : prev,
      );
      if (res.data?.rewardClaimed) {
        setRewardMessage(t('polls.rewardClaimed', 'You earned {{amount}} {{currency}}!', { amount: res.data.rewardClaimed, currency: currency.softPlural }));
      }
      qc.invalidateQueries({ queryKey: ['polls', 'treasury', slug] });
    },
    onError: (err) => {
      if (isAxiosError<{ error?: { message?: string } }>(err)) {
        setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
        return;
      }
      setErrorMessage(t('error.generic'));
    },
  });

  const share = useMutation({
    mutationFn: () => apiClient.post<{ shareCount: number; rewardClaimed: number | null }>(`/polls/${slug}/share`, {}),
    onSuccess: (res) => {
      qc.setQueryData<PollDetail>(['polls', 'detail', slug], (prev) => (prev ? { ...prev, shareCount: res.data?.shareCount ?? prev.shareCount } : prev));
      if (res.data?.rewardClaimed) {
        setRewardMessage(t('polls.rewardClaimed', 'You earned {{amount}} {{currency}}!', { amount: res.data.rewardClaimed, currency: currency.softPlural }));
      }
    },
  });

  const fundTreasury = useMutation({
    mutationFn: ({ amount, maxClaimants }: { amount: number; maxClaimants: number }) =>
      apiClient.post<Treasury>(`/polls/${slug}/treasury`, { amount, maxClaimants }),
    onSuccess: (res) => {
      qc.setQueryData(['polls', 'treasury', slug], res.data);
      setFundingOpen(false);
    },
    onError: (err) => {
      if (isAxiosError<{ error?: { message?: string } }>(err)) {
        setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
      }
    },
  });

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'closed' | 'disabled') => apiClient.patch(`/polls/${slug}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['polls', 'detail', slug] }),
  });

  const deletePoll = useMutation({
    mutationFn: () => apiClient.delete(`/polls/${slug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['polls', 'list'] });
      navigate({ to: '/polls' });
    },
  });

  async function handleShare(): Promise<void> {
    const url = universalLink(PUBLIC_PATHS.poll(slug));
    share.mutate();
    try {
      if (navigator.share) {
        await navigator.share({ title: poll?.title, url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // no fallback UI available
    }
  }

  function toggleOption(optionId: string) {
    if (!poll) return;
    if (poll.allowMultiple) {
      setSelected((prev) => (prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]));
    } else {
      setSelected([optionId]);
    }
  }

  if (pollQuery.isPending) {
    return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  }

  if (!poll) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center">
        <p className="text-sm text-neutral-500">{t('polls.notFound', 'Poll not found')}</p>
        <Link to="/polls" className="mt-3 inline-block text-sm font-semibold text-primary-600">← {t('polls.title', 'Polls')}</Link>
      </div>
    );
  }

  const showResults = hasVoted || poll.status !== 'active' || poll.isOwner;
  const treasury = treasuryQuery.data;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-base font-bold text-neutral-900">{poll.title}</h1>
          {poll.status !== 'active' && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">
              {poll.status === 'closed' ? t('polls.status.closed', 'Closed') : t('polls.status.disabled', 'Disabled')}
            </span>
          )}
        </div>
        {poll.description && <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{poll.description}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>@{poll.creatorUsername ?? 'unknown'}</span>
          <span>·</span>
          <span>{timeAgo(poll.createdAt)}</span>
          <span>·</span>
          <span>{poll.voterCount} {poll.voterCount === 1 ? t('polls.voter', 'voter') : t('polls.voters', 'voters')}</span>
          {poll.closesAt && (
            <>
              <span>·</span>
              <span>{t('polls.closesAt', 'Closes {{date}}', { date: new Date(poll.closesAt).toLocaleDateString() })}</span>
            </>
          )}
        </div>
      </div>

      {rewardMessage && <div className="rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700">{rewardMessage}</div>}
      {errorMessage && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}

      <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-2">
        {poll.options.map((opt) => {
          const pct = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
          const isMine = poll.myVoteOptionIds.includes(opt.id);
          const isChecked = selected.includes(opt.id);

          if (showResults) {
            return (
              <div key={opt.id} className="relative overflow-hidden rounded-lg border border-neutral-200">
                <div className="absolute inset-y-0 left-0 bg-primary-100" style={{ width: `${pct}%` }} />
                <div className="relative flex items-center justify-between px-3 py-2.5">
                  <span className={`text-sm ${isMine ? 'font-semibold text-primary-700' : 'text-neutral-800'}`}>
                    {isMine && '✓ '}{opt.label}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-neutral-600">{pct}% ({opt.voteCount})</span>
                </div>
              </div>
            );
          }

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggleOption(opt.id)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm ${isChecked ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-200 text-neutral-800'}`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center border ${poll.allowMultiple ? 'rounded' : 'rounded-full'} ${isChecked ? 'border-primary-600 bg-primary-600' : 'border-neutral-300'}`}
              >
                {isChecked && <span className="text-[10px] text-white">✓</span>}
              </span>
              {opt.label}
            </button>
          );
        })}

        {!showResults && (
          <button
            type="button"
            disabled={selected.length === 0 || vote.isPending}
            onClick={() => vote.mutate(selected)}
            className="mt-2 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {vote.isPending ? t('polls.voting', 'Voting…') : t('polls.vote', 'Vote')}
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => void handleShare()} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-600">
          {shareCopied ? t('answers.linkCopied', 'Link copied') : t('polls.share', 'Share')} ({poll.shareCount})
        </button>
        {poll.isOwner && (
          <button onClick={() => setFundingOpen(true)} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-600">
            {t('polls.treasury.cta', 'Fund Reward Pot')}
          </button>
        )}
      </div>

      {treasury && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">{t('polls.treasury.active', 'Reward Pot Active')}</p>
          <p className="mt-1 text-xs text-amber-700">
            {t('polls.treasury.remaining', '{{remaining}} {{currency}} remaining · {{claimed}}/{{max}} claimed', {
              remaining: treasury.remainingAmount,
              currency: currency.softPlural,
              claimed: treasury.claimantCount,
              max: treasury.maxClaimants,
            })}
          </p>
        </div>
      )}

      {poll.isOwner && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('polls.owner.manage', 'Manage')}</p>
          <div className="flex flex-wrap gap-2">
            {poll.status !== 'closed' && (
              <button onClick={() => setStatus.mutate('closed')} disabled={setStatus.isPending} className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                {t('polls.owner.close', 'Close poll')}
              </button>
            )}
            {poll.status !== 'active' && (
              <button onClick={() => setStatus.mutate('active')} disabled={setStatus.isPending} className="rounded-lg bg-success-100 px-3 py-1.5 text-xs font-semibold text-success-700 disabled:opacity-50">
                {t('polls.owner.reopen', 'Reopen poll')}
              </button>
            )}
            <button onClick={() => deletePoll.mutate()} disabled={deletePoll.isPending} className="rounded-lg bg-danger-100 px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-50">
              {t('common.delete', 'Delete')}
            </button>
          </div>
        </div>
      )}

      {fundingOpen && (
        <FundTreasuryModal
          onClose={() => setFundingOpen(false)}
          saving={fundTreasury.isPending}
          onSave={(amount, maxClaimants) => fundTreasury.mutate({ amount, maxClaimants })}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/polls/$slug')({
  component: PollDetailPage,
});
