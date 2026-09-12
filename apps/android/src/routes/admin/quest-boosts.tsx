/**
 * apps/android/src/routes/admin/quest-boosts.tsx
 *
 * Daily Quest Campaign Boosts — mirrors apps/web/app/(admin)/gate44/quests/boosts/page.tsx.
 * GET /admin/quest-boosts -> { boosts, featureKeys } (auto-unwrapped).
 * POST /admin/quest-boosts { featureKey, weightMultiplier, startsAt, endsAt, note? }.
 * DELETE /admin/quest-boosts/:id.
 */

import { useState, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  AdminField,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

interface Boost {
  id: string;
  feature_key: string;
  weight_multiplier: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  created_by_username: string | null;
  created_at: string;
}

const FEATURE_LABELS: Record<string, string> = {
  games: 'Games',
  blogs: 'Blogs',
  wiki: 'Wiki',
  polls: 'Polls',
  quizzes: 'Quizzes',
  bbforum: 'Forum',
  gifts: 'Gifts',
  rooms: 'Rooms',
};

function isActive(b: Boost): boolean {
  const now = Date.now();
  return new Date(b.starts_at).getTime() <= now && new Date(b.ends_at).getTime() >= now;
}

async function fetchBoosts(): Promise<{ boosts: Boost[]; featureKeys: string[] }> {
  const { data } = await apiClient.get<{ boosts: Boost[]; featureKeys: string[] }>('/admin/quest-boosts');
  return { boosts: data?.boosts ?? [], featureKeys: data?.featureKeys ?? [] };
}

function AdminQuestBoostsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'quest-boosts'], queryFn: fetchBoosts });

  const [featureKey, setFeatureKey] = useState('');
  const [weightMultiplier, setWeightMultiplier] = useState('2');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (data?.featureKeys?.length && !featureKey) setFeatureKey(data.featureKeys[0]);
  }, [data?.featureKeys, featureKey]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'quest-boosts'] });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/admin/quest-boosts', {
        featureKey,
        weightMultiplier: Number(weightMultiplier),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      showToast(t('admin.questBoosts.scheduled', 'Boost scheduled'));
      setStartsAt(''); setEndsAt(''); setNote(''); setWeightMultiplier('2');
      invalidate();
    },
    onError: () => showToast(t('admin.questBoosts.createFailed', 'Failed to schedule boost'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/quest-boosts/${id}`),
    onSuccess: () => {
      showToast(t('admin.questBoosts.ended', 'Boost ended'));
      invalidate();
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-bold text-neutral-900 mb-1">{t('admin.questBoosts.pageTitle', 'Daily Quest Campaign Boosts')}</h1>
      <p className="mb-4 text-xs text-neutral-500">
        {t('admin.questBoosts.subtitle', "Promote a feature's quests for a date range — e.g. show more Blog and Wiki quests for the next week. With nothing scheduled, quests are picked with no bias.")}
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminCard>
        <div className="space-y-3">
          <AdminField label={t('admin.questBoosts.feature', 'Feature')}>
            <select value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} className={adminInputClass}>
              {(data?.featureKeys ?? []).map((k) => <option key={k} value={k}>{FEATURE_LABELS[k] ?? k}</option>)}
            </select>
          </AdminField>
          <AdminField label={t('admin.questBoosts.weight', 'Weight (higher = shown more)')}>
            <input type="number" min="1.1" max="10" step="0.5" value={weightMultiplier} onChange={(e) => setWeightMultiplier(e.target.value)} className={adminInputClass} />
          </AdminField>
          <div className="grid grid-cols-2 gap-2">
            <AdminField label={t('admin.questBoosts.start', 'Start')}>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.questBoosts.end', 'End')}>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={adminInputClass} />
            </AdminField>
          </div>
          <AdminField label={t('admin.questBoosts.note', 'Note (optional)')}>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={adminInputClass} placeholder={t('admin.questBoosts.notePlaceholder', 'e.g. Wiki launch week')} />
          </AdminField>
          <button
            type="button"
            disabled={createMutation.isPending || !startsAt || !endsAt || !featureKey}
            onClick={() => createMutation.mutate()}
            className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {createMutation.isPending ? '…' : t('admin.questBoosts.schedule', 'Schedule Boost')}
          </button>
        </div>
      </AdminCard>

      <div className="mt-4 space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (data?.boosts.length ?? 0) === 0 && (
          <AdminEmptyState icon="📈" title={t('admin.questBoosts.empty', 'No boosts scheduled')} hint={t('admin.questBoosts.emptyHint', 'Quests are picked with no bias across enabled features.')} />
        )}
        {status === 'success' &&
          data?.boosts.map((b) => (
            <AdminCard key={b.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-neutral-900">{FEATURE_LABELS[b.feature_key] ?? b.feature_key}</span>
                    <AdminBadge
                      label={isActive(b) ? t('admin.questBoosts.active', 'Active') : new Date(b.starts_at) > new Date() ? t('admin.questBoosts.upcoming', 'Upcoming') : t('admin.questBoosts.ended2', 'Ended')}
                      color={isActive(b) ? 'green' : 'neutral'}
                    />
                    <span className="text-xs text-neutral-500">×{b.weight_multiplier}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {fmtDate(b.starts_at)} → {fmtDate(b.ends_at)}{b.note ? ` · ${b.note}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(b.id)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50"
                >
                  {t('admin.questBoosts.endNow', 'End now')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/quest-boosts')({
  component: AdminQuestBoostsPage,
});
