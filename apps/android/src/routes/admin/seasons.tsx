/**
 * apps/android/src/routes/admin/seasons.tsx
 *
 * Season lifecycle management — mirrors apps/web/app/(admin)/admin/seasons/page.tsx:
 * list all seasons (current + history), create a new one (auto-deactivates any
 * currently active season server-side), and end the active season early.
 */

import { useState } from 'react';
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
  AdminConfirmDialog,
  AdminField,
  adminInputClass,
  fmtDate,
  fmtNumber,
} from '@/components/admin/AdminUI';

interface Season {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
  reward_pool_coins: number;
  description: string | null;
  created_at: string;
}

interface SeasonFormData {
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  pass_price_coins: string;
  reward_pool_coins: string;
  description: string;
}

function defaultForm(): SeasonFormData {
  return { name: '', theme: '', starts_at: '', ends_at: '', pass_price_coins: '500', reward_pool_coins: '0', description: '' };
}

function seasonStatus(season: Season, t: (k: string, d: string) => string): { label: string; color: 'green' | 'blue' | 'neutral' } {
  const now = new Date();
  const start = new Date(season.starts_at);
  const end = new Date(season.ends_at);
  if (season.is_active && now >= start && now <= end) return { label: t('admin.seasons.active', 'Active'), color: 'green' };
  if (start > now) return { label: t('admin.seasons.upcoming', 'Upcoming'), color: 'blue' };
  return { label: t('admin.seasons.ended', 'Ended'), color: 'neutral' };
}

async function fetchSeasons(): Promise<Season[]> {
  const { data } = await apiClient.get<{ seasons: Season[] }>('/admin/seasons');
  return data?.seasons ?? [];
}

function CreateSeasonModal({
  onSave,
  onClose,
  saving,
  error,
}: {
  onSave: (form: SeasonFormData) => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<SeasonFormData>(defaultForm());

  function set<K extends keyof SeasonFormData>(key: K, value: SeasonFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="mb-4 text-base font-bold text-neutral-900">{t('admin.seasons.createTitle', 'Create Season')}</h3>
        <div className="space-y-3">
          <AdminField label={t('admin.seasons.name', 'Name')}>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Season 3 — Rise of the Legends" className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.seasons.theme', 'Theme')}>
            <input type="text" value={form.theme} onChange={(e) => set('theme', e.target.value)} placeholder="fire, ocean, neon…" className={adminInputClass} />
          </AdminField>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label={t('admin.events.startsAt', 'Starts At')}>
              <input type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.events.endsAt', 'Ends At')}>
              <input type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} className={adminInputClass} />
            </AdminField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label={t('admin.seasons.passPrice', 'Pass Price (coins)')}>
              <input type="number" min={1} value={form.pass_price_coins} onChange={(e) => set('pass_price_coins', e.target.value)} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.seasons.rewardPool', 'Reward Pool (coins)')}>
              <input type="number" min={0} value={form.reward_pool_coins} onChange={(e) => set('reward_pool_coins', e.target.value)} className={adminInputClass} />
            </AdminField>
          </div>
          <AdminField label={t('admin.seasons.description', 'Description (optional)')}>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={500} className={`${adminInputClass} resize-none`} />
          </AdminField>
          {error && <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</p>}
        </div>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSave(form)}
            disabled={saving || !form.name.trim() || !form.theme.trim() || !form.starts_at || !form.ends_at}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '…' : t('admin.seasons.create', 'Create Season')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminSeasonsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [ending, setEnding] = useState<Season | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'seasons'], queryFn: fetchSeasons });

  const createMutation = useMutation({
    mutationFn: (form: SeasonFormData) =>
      apiClient.post('/admin/seasons', {
        name: form.name.trim(),
        theme: form.theme.trim(),
        startsAt: new Date(form.starts_at).toISOString(),
        endsAt: new Date(form.ends_at).toISOString(),
        passPriceCoins: parseInt(form.pass_price_coins, 10) || 500,
        rewardPoolCoins: parseInt(form.reward_pool_coins, 10) || 0,
        description: form.description.trim() || undefined,
      }),
    onSuccess: () => {
      showToast(t('admin.seasons.created', 'Season created'));
      setShowModal(false);
      setCreateError(null);
      qc.invalidateQueries({ queryKey: ['admin', 'seasons'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? t('admin.seasons.createFailed', 'Failed to create season');
      setCreateError(msg);
    },
  });

  const endMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/seasons/${id}`),
    onSuccess: () => {
      showToast(t('admin.seasons.ended', 'Season ended and rewards distributed'));
      setEnding(null);
      qc.invalidateQueries({ queryKey: ['admin', 'seasons'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.seasons', 'Seasons')}</h1>
        <button
          type="button"
          onClick={() => { setCreateError(null); setShowModal(true); }}
          className="rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white"
        >
          + {t('admin.seasons.create', 'Create')}
        </button>
      </div>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (data?.length ?? 0) === 0 && (
          <AdminEmptyState icon="🏆" title={t('admin.seasons.empty', 'No seasons yet')} hint={t('admin.seasons.emptyHint', 'Create the first season to get started.')} />
        )}
        {status === 'success' &&
          data?.map((s) => {
            const st = seasonStatus(s, t);
            return (
              <AdminCard key={s.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-neutral-900 truncate">{s.name}</p>
                      <AdminBadge label={st.label} color={st.color} />
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">{t('admin.seasons.theme', 'Theme')}: {s.theme}</p>
                    {s.description && <p className="mt-1 text-xs text-neutral-500 line-clamp-2">{s.description}</p>}
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                  <span>{t('admin.seasons.starts', 'Starts')}: {fmtDate(s.starts_at)}</span>
                  <span>{t('admin.seasons.ends', 'Ends')}: {fmtDate(s.ends_at)}</span>
                  <span>{t('admin.seasons.passPrice', 'Pass Price')}: {fmtNumber(s.pass_price_coins)}</span>
                  <span>{t('admin.seasons.rewardPool', 'Reward Pool')}: {fmtNumber(s.reward_pool_coins)}</span>
                </div>
                {s.is_active && (
                  <button type="button" onClick={() => setEnding(s)} className="mt-3 rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700">
                    {t('admin.seasons.endEarly', 'End Season Early')}
                  </button>
                )}
              </AdminCard>
            );
          })}
      </div>

      {showModal && (
        <CreateSeasonModal
          onSave={(form) => createMutation.mutate(form)}
          onClose={() => setShowModal(false)}
          saving={createMutation.isPending}
          error={createError}
        />
      )}

      {ending && (
        <AdminConfirmDialog
          title={t('admin.seasons.confirmEnd', 'End this season now?')}
          description={t('admin.seasons.confirmEndDesc', 'Rewards will be distributed to the top 10 finishers immediately.')}
          confirmLabel={t('admin.seasons.endEarly', 'End Season Early')}
          cancelLabel={t('common.cancel')}
          danger
          pending={endMutation.isPending}
          onCancel={() => setEnding(null)}
          onConfirm={() => endMutation.mutate(ending.id)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/seasons')({
  component: AdminSeasonsPage,
});
