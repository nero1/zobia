/**
 * apps/android/src/routes/quests/manage.tsx
 *
 * "My Sponsored Quests" panel — mirrors apps/web/app/(app)/quests/manage/page.tsx.
 * For a user an admin assigned as a quest "creator"/campaign manager
 * (sponsored_quests.owner_user_id). Shows stats and campaign progress; can
 * revive/extend/add budget, but can never edit the quest's public-facing
 * details — that stays admin-only.
 *
 * GET /quests/owned -> { quests } (auto-unwrapped).
 * PATCH /quests/owned/:id { action: 'revive'|'extend'|'add_budget', newEndsAt?, addBudgetCredits? }.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

interface OwnedQuest {
  id: string;
  brand_name: string;
  title: string;
  description: string;
  reward_coins: number;
  is_active: boolean;
  moderation_status: string;
  auto_paused: boolean;
  pause_reason: string | null;
  flag_status: string;
  is_daily_quest_eligible: boolean;
  starts_at: string | null;
  ends_at: string | null;
  deadline: string;
  total_budget_credits: string;
  spent_credits: string;
  estimated_reach: number | null;
  impressions_count: number;
  completions_count: number;
  application_count: number;
  approved_count: number;
  created_at: string;
}

async function fetchOwnedQuests(): Promise<OwnedQuest[]> {
  const { data } = await apiClient.get<{ quests: OwnedQuest[] }>('/quests/owned');
  return data?.quests ?? [];
}

function QuestManagePage() {
  const { t } = useTranslation();
  const currency = useCurrency();
  const qc = useQueryClient();
  const { data: quests, status } = useQuery({ queryKey: ['quests', 'owned'], queryFn: fetchOwnedQuests });

  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [extendTarget, setExtendTarget] = useState<OwnedQuest | null>(null);
  const [newEndsAt, setNewEndsAt] = useState('');
  const [budgetTarget, setBudgetTarget] = useState<OwnedQuest | null>(null);
  const [addBudget, setAddBudget] = useState(1000);

  const actMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => {
      setBusyId(id);
      return apiClient.patch(`/quests/owned/${id}`, body);
    },
    onSuccess: () => {
      setExtendTarget(null);
      setBudgetTarget(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ['quests', 'owned'] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('quests.manage.actionFailed', 'Failed to update')),
    onSettled: () => setBusyId(null),
  });

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-neutral-200" />)}
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
        <h1 className="text-xl font-bold text-neutral-900">{t('quests.manage.title', 'My Sponsored Quests')}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {t('quests.manage.subtitle', 'Quests an admin has attributed to your account. You can see stats and revive, extend, or add budget — public details can only be changed by an admin.')}
        </p>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {!quests || quests.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-neutral-200 bg-white py-16">
          <span className="text-5xl">🎯</span>
          <p className="mt-3 font-semibold text-neutral-700">{t('quests.manage.empty', 'No quests attributed to you yet')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {quests.map((q) => (
            <div key={q.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <p className="font-semibold text-neutral-900">{q.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${q.is_active ? 'bg-teal-100 text-teal-700' : 'bg-neutral-100 text-neutral-500'}`}>
                  {q.is_active ? t('quests.manage.live', 'Live') : t('quests.manage.stopped', 'Stopped')}
                </span>
                {q.flag_status === 'flagged' && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">🚩 {t('quests.manage.flagged', 'Flagged')}</span>
                )}
              </div>
              <p className="mb-2 text-sm text-neutral-500 line-clamp-2">{q.description}</p>
              {q.pause_reason && (
                <p className="mb-2 text-xs text-amber-600">
                  {q.auto_paused ? '⚠️ ' : ''}{t('quests.manage.pauseReason', '{{prefix}}: {{reason}}', {
                    prefix: q.auto_paused ? t('quests.manage.autoPaused', 'Auto-paused') : t('quests.manage.paused', 'Paused'),
                    reason: q.pause_reason,
                  })}
                  {q.auto_paused ? ` ${t('quests.manage.autoPausedHint', '— resolve the underlying account issue and restart from your Business panel.')}` : ''}
                </p>
              )}
              <div className="mb-2 grid grid-cols-2 gap-2 text-xs text-neutral-500">
                <div>📋 {t('quests.manage.applications', '{{count}} applications', { count: q.application_count })}</div>
                <div>✅ {t('quests.manage.approved', '{{count}} approved', { count: q.approved_count })}</div>
                <div>🏁 {t('quests.manage.completions', '{{count}} completions', { count: q.completions_count })}</div>
                <div>🪙 {t('quests.manage.reward', '{{count}} {{currency}} reward', { count: q.reward_coins, currency: currency.softPlural })}</div>
              </div>
              {q.is_daily_quest_eligible && (
                <p className="mb-2 text-xs text-neutral-400">
                  {t('quests.manage.spendLine', '{{spent}}/{{total}} {{currency}} spent · {{impressions}} impressions', {
                    spent: Number(q.spent_credits).toLocaleString(),
                    total: Number(q.total_budget_credits).toLocaleString(),
                    currency: currency.softPlural,
                    impressions: q.impressions_count.toLocaleString(),
                  })}
                  {q.estimated_reach ? ` · ${t('quests.manage.estReach', 'est. reach {{count}}', { count: q.estimated_reach.toLocaleString() })}` : ''}
                  {q.ends_at ? ` · ${t('quests.manage.ends', 'ends {{date}}', { date: new Date(q.ends_at).toLocaleDateString() })}` : ''}
                </p>
              )}
              {q.flag_status !== 'flagged' && q.moderation_status === 'approved' && (
                <div className="flex flex-wrap gap-2">
                  {!q.is_active && !q.auto_paused && (
                    <button
                      onClick={() => actMutation.mutate({ id: q.id, body: { action: 'revive' } })}
                      disabled={busyId === q.id}
                      className="rounded-lg bg-success-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {t('quests.manage.revive', 'Revive')}
                    </button>
                  )}
                  {q.is_daily_quest_eligible && (
                    <>
                      <button
                        onClick={() => { setExtendTarget(q); setNewEndsAt(q.ends_at ? q.ends_at.slice(0, 16) : ''); }}
                        className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-700"
                      >
                        {t('quests.manage.extend', 'Extend')}
                      </button>
                      <button
                        onClick={() => { setBudgetTarget(q); setAddBudget(1000); }}
                        className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-700"
                      >
                        {t('quests.manage.addBudget', 'Add Budget')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {extendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <h3 className="mb-3 font-semibold text-neutral-900">{t('quests.manage.extendTitle', 'Extend "{{title}}"', { title: extendTarget.title })}</h3>
            <input type="datetime-local" value={newEndsAt} onChange={(e) => setNewEndsAt(e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm" />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setExtendTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium text-neutral-700">{t('common.cancel')}</button>
              <button
                disabled={busyId === extendTarget.id || !newEndsAt}
                onClick={() => actMutation.mutate({ id: extendTarget.id, body: { action: 'extend', newEndsAt: new Date(newEndsAt).toISOString() } })}
                className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('quests.manage.save', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {budgetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <h3 className="mb-3 font-semibold text-neutral-900">{t('quests.manage.addBudgetTitle', 'Add Budget to "{{title}}"', { title: budgetTarget.title })}</h3>
            <input type="number" min={1} value={addBudget} onChange={(e) => setAddBudget(Number(e.target.value))} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm" />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setBudgetTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium text-neutral-700">{t('common.cancel')}</button>
              <button
                disabled={busyId === budgetTarget.id || !addBudget}
                onClick={() => actMutation.mutate({ id: budgetTarget.id, body: { action: 'add_budget', addBudgetCredits: Number(addBudget) } })}
                className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('quests.manage.add', 'Add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/quests/manage')({
  component: QuestManagePage,
});
