/**
 * apps/android/src/routes/wiki/$slug/treasury.tsx
 *
 * Reward pot (treasury) — owner funds a pot split among the first N
 * contributors/sharers, everyone else just sees its current state. Mirrors
 * the read-only treasury badge routes/blogs/$slug/$postSlug.tsx renders for
 * blog posts, plus an owner-only fund form.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { fetchWiki, fetchTreasury } from '@/lib/wiki/api';

function WikiTreasuryPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [maxClaimants, setMaxClaimants] = useState('');

  const wikiQuery = useQuery({ queryKey: ['wiki', 'detail', slug], queryFn: () => fetchWiki(slug) });
  const treasuryQuery = useQuery({ queryKey: ['wiki', 'treasury', slug], queryFn: () => fetchTreasury(slug) });
  const treasury = treasuryQuery.data;
  const isEditing = !!treasury && treasury.status !== 'closed';

  // Prefill the form with the current pot's numbers once it loads, so
  // editing starts from its real values rather than an empty form.
  useEffect(() => {
    if (treasury && treasury.status !== 'closed') {
      setAmount(String(treasury.fundedAmount));
      setMaxClaimants(String(treasury.maxClaimants));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treasury?.id]);

  const fund = useMutation({
    mutationFn: () =>
      isEditing
        ? apiClient.patch(`/wiki/${slug}/treasury`, {
            amount: parseInt(amount, 10),
            maxClaimants: parseInt(maxClaimants, 10),
          })
        : apiClient.post(`/wiki/${slug}/treasury`, {
            amount: parseInt(amount, 10),
            maxClaimants: parseInt(maxClaimants, 10),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'treasury', slug] });
    },
  });

  const closeTreasury = useMutation({
    mutationFn: () => apiClient.delete(`/wiki/${slug}/treasury`),
    onSuccess: () => {
      setAmount('');
      setMaxClaimants('');
      qc.invalidateQueries({ queryKey: ['wiki', 'treasury', slug] });
    },
  });

  if (wikiQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 p-4"><div className="h-24 rounded bg-neutral-200 dark:bg-neutral-700 animate-pulse" /></div>;

  const isOwner = wikiQuery.data?.isOwner ?? false;
  const validAmount = /^\d+$/.test(amount) && parseInt(amount, 10) > 0;
  const validMax = /^\d+$/.test(maxClaimants) && parseInt(maxClaimants, 10) > 0;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 p-4 space-y-4">
      <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{t('wiki.treasury.title', 'Reward pot')}</h1>

      {treasury && treasury.status === 'active' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/30 p-4 text-sm text-amber-800 dark:text-amber-300">
          🎁 {t('wiki.treasury.activeSummary', '{{amount}} credits each for the next {{slots}} contributors or sharers.', {
            amount: treasury.rewardPerClaimant,
            slots: Math.max(treasury.maxClaimants - treasury.claimantCount, 0),
          })}
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            {t('wiki.treasury.claimedSoFar', '{{claimed}} of {{max}} claimed so far.', { claimed: treasury.claimantCount, max: treasury.maxClaimants })}
          </p>
        </div>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('wiki.treasury.empty', 'No active reward pot right now.')}</p>
      )}

      {isOwner && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 space-y-2.5">
          <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{t('wiki.treasury.fundTitle', 'Fund the pot')}</h2>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
            placeholder={t('wiki.treasury.amountPlaceholder', 'Total credits to fund')}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          <input
            inputMode="numeric"
            value={maxClaimants}
            onChange={(e) => setMaxClaimants(e.target.value.replace(/[^\d]/g, ''))}
            placeholder={t('wiki.treasury.maxClaimantsPlaceholder', 'Number of people who can claim')}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          <button
            disabled={!validAmount || !validMax || fund.isPending}
            onClick={() => fund.mutate()}
            className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {fund.isPending
              ? isEditing ? t('wiki.treasury.saving', 'Saving…') : t('wiki.treasury.funding', 'Funding…')
              : isEditing ? t('wiki.treasury.saveChanges', 'Save changes') : t('wiki.treasury.fund', 'Fund pot')}
          </button>
          {isEditing && (
            <button
              disabled={closeTreasury.isPending}
              onClick={() => closeTreasury.mutate()}
              className="w-full rounded-xl border border-red-300 dark:border-red-800 py-2.5 text-sm font-semibold text-red-600 dark:text-red-300 disabled:opacity-50"
            >
              {closeTreasury.isPending ? t('wiki.treasury.turningOff', 'Turning off…') : t('wiki.treasury.turnOff', 'Turn off reward')}
            </button>
          )}
          {(fund.isError || closeTreasury.isError) && <p className="text-xs text-red-600 dark:text-red-300">{t('error.generic')}</p>}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/wiki/$slug/treasury')({
  component: WikiTreasuryPage,
});
