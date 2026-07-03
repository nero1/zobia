/**
 * apps/android/src/routes/creator/marketplace.tsx
 *
 * Creator Marketplace — mirrors apps/web/app/(app)/creator/marketplace/
 * page.tsx: sponsored quests creators can apply to run in their Rooms.
 *
 * CONTRACT FIX (see report): the web page called GET /api/quests/sponsored
 * and POST /api/quests/sponsored/:id/apply, neither of which exists — the
 * real endpoints are under /api/creator/sponsored-quests (fixed in the same
 * commit, apps/web/app/(app)/creator/marketplace/page.tsx). This page uses
 * the real endpoint and its snake_case row shape directly.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface SponsoredQuestRow {
  id: string;
  brand_name: string;
  title: string;
  description: string;
  requirements: string;
  reward_coins: number;
  creator_share_percent: number;
  max_applications: number;
  deadline: string;
  is_active: boolean;
  application_count: number;
  user_has_applied: boolean;
}

function formatNgn(amount: number): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

function questStatus(q: SponsoredQuestRow): 'open' | 'closed' | 'full' {
  if (!q.is_active || new Date(q.deadline) <= new Date()) return 'closed';
  if (q.application_count >= q.max_applications) return 'full';
  return 'open';
}

async function fetchQuests(): Promise<SponsoredQuestRow[]> {
  const { data } = await apiClient.get<{ quests: SponsoredQuestRow[] }>('/creator/sponsored-quests');
  return data?.quests ?? [];
}

function CreatorMarketplacePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const { data: quests, status } = useQuery({ queryKey: ['creator', 'sponsored-quests'], queryFn: fetchQuests });

  const applyMutation = useMutation({
    mutationFn: async (questId: string) => {
      setApplyingId(questId);
      await apiClient.post(`/creator/sponsored-quests/${questId}/apply`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creator', 'sponsored-quests'] }),
    onSettled: () => setApplyingId(null),
  });

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-neutral-200" />)}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return <div className="p-6 text-sm text-red-600">{t('error.generic')}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">{t('creator.marketplace.title', 'Creator Marketplace')}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">{t('creator.marketplace.subtitle', 'Apply for sponsored quests and earn from brand campaigns.')}</p>
      </div>

      {!quests || quests.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-neutral-200 bg-white py-16">
          <span className="text-5xl">📋</span>
          <p className="mt-3 font-semibold text-neutral-700">{t('creator.marketplace.empty', 'No quests available')}</p>
          <p className="mt-1 text-sm text-neutral-500">{t('creator.marketplace.emptyHint', 'New brand campaigns will appear here. Check back soon!')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {quests.map((q) => {
            const status = questStatus(q);
            const applied = q.user_has_applied;
            const canApply = status === 'open' && !applied;
            const creatorPayout = Math.round((q.reward_coins * q.creator_share_percent) / 100);
            return (
              <div key={q.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-lg">🏷️</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-neutral-500">{q.brand_name}</p>
                    <p className="font-semibold text-neutral-900">{q.title}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${status === 'open' ? 'bg-teal-100 text-teal-700' : status === 'full' ? 'bg-amber-100 text-amber-700' : 'bg-neutral-100 text-neutral-600'}`}>
                    {status}
                  </span>
                </div>
                <p className="mb-2 text-sm text-neutral-600 line-clamp-2">{q.description}</p>
                <div className="mb-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                  <p className="text-xs font-semibold text-neutral-500">{t('creator.marketplace.requiredAction', 'Required Action')}</p>
                  <p className="text-sm text-neutral-800">{q.requirements}</p>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-center">
                    <p className="text-xs text-amber-600">{t('creator.marketplace.userReward', 'User Reward')}</p>
                    <p className="font-bold text-amber-700">🪙 {q.reward_coins.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-teal-200 bg-teal-50 p-2 text-center">
                    <p className="text-xs text-teal-600">{t('creator.marketplace.creatorPayout', 'Creator Payout')}</p>
                    <p className="font-bold text-teal-700">{formatNgn(creatorPayout)}</p>
                  </div>
                </div>
                <p className="mb-3 text-xs text-neutral-500">{q.application_count} / {q.max_applications} {t('creator.marketplace.applicants', 'applicants')}</p>
                {applied ? (
                  <div className="rounded-xl bg-teal-50 py-2 text-center text-sm font-semibold text-teal-700">✓ {t('creator.marketplace.applied', 'Applied')}</div>
                ) : (
                  <button
                    onClick={() => canApply && applyMutation.mutate(q.id)}
                    disabled={!canApply || applyingId === q.id}
                    className={`w-full rounded-xl py-2.5 text-sm font-semibold ${canApply ? 'bg-primary-600 text-white disabled:opacity-60' : 'cursor-not-allowed bg-neutral-100 text-neutral-400'}`}
                  >
                    {applyingId === q.id ? t('creator.marketplace.applying', 'Applying…') : status === 'full' ? t('creator.marketplace.full', 'Full') : status === 'closed' ? t('creator.marketplace.closed', 'Closed') : t('creator.marketplace.apply', 'Apply')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Link to="/creator" className="block text-center text-sm text-primary-600">
        ← {t('creator.title', 'Creator Dashboard')}
      </Link>
    </div>
  );
}

export const Route = createFileRoute('/creator/marketplace')({
  component: CreatorMarketplacePage,
});
