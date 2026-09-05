/**
 * apps/android/src/routes/admin/gifts.tsx
 *
 * Gifts Catalog — mirrors apps/web/app/(admin)/admin/gifts/page.tsx.
 * GET /admin/gifts?limit=&cursor=&retired= -> {success,data:{gifts,nextCursor}} (auto-unwrapped).
 * POST /admin/gifts (create), PATCH /admin/gifts/:id (edit/restore), DELETE /admin/gifts/:id (retire).
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';
import {
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  AdminToggle,
  AdminField,
  adminInputClass,
  fmtNumber,
} from '@/components/admin/AdminUI';

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  animationUrl: string | null;
  spectacleThresholdCoins: number | null;
  isActive: boolean;
}

interface GiftForm {
  name: string;
  emoji: string;
  coinCost: string;
  tier: string;
  animationUrl: string;
  spectacleThresholdCoins: string;
}

const EMPTY_FORM: GiftForm = { name: '', emoji: '', coinCost: '', tier: '1', animationUrl: '', spectacleThresholdCoins: '' };

const TIER_COLOR: Record<number, 'neutral' | 'blue' | 'teal' | 'gold'> = { 1: 'neutral', 2: 'blue', 3: 'teal', 4: 'gold', 5: 'gold' };

async function fetchGifts(showRetired: boolean): Promise<GiftItem[]> {
  const params = new URLSearchParams({ limit: '50' });
  if (showRetired) params.set('retired', 'true');
  const { data } = await apiClient.get<{ gifts: GiftItem[] }>(`/admin/gifts?${params}`);
  return data?.gifts ?? [];
}

function AdminGiftsPage() {
  const { t } = useTranslation();
  const currency = useCurrency();
  const qc = useQueryClient();
  const [showRetired, setShowRetired] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<GiftItem | null>(null);
  const [form, setForm] = useState<GiftForm>(EMPTY_FORM);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: gifts, status, refetch } = useQuery({ queryKey: ['admin', 'gifts', showRetired], queryFn: () => fetchGifts(showRetired) });

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (g: GiftItem) => {
    setEditTarget(g);
    setForm({
      name: g.name,
      emoji: g.emoji,
      coinCost: String(g.coinCost),
      tier: String(g.tier),
      animationUrl: g.animationUrl ?? '',
      spectacleThresholdCoins: g.spectacleThresholdCoins != null ? String(g.spectacleThresholdCoins) : '',
    });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        emoji: form.emoji.trim(),
        coinCost: parseInt(form.coinCost, 10),
        tier: parseInt(form.tier, 10),
        animationUrl: form.animationUrl.trim() || null,
        spectacleThresholdCoins: form.spectacleThresholdCoins ? parseInt(form.spectacleThresholdCoins, 10) : null,
      };
      return editTarget ? apiClient.patch(`/admin/gifts/${editTarget.id}`, body) : apiClient.post('/admin/gifts', body);
    },
    onSuccess: () => {
      showToast(editTarget ? t('admin.gifts.updated', 'Gift updated') : t('admin.gifts.created', 'Gift created'));
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['admin', 'gifts'] });
    },
    onError: () => showToast(t('admin.gifts.saveFailed', 'Failed to save'), 'error'),
  });

  const retireMutation = useMutation({
    mutationFn: (g: GiftItem) => (g.isActive ? apiClient.delete(`/admin/gifts/${g.id}`) : apiClient.patch(`/admin/gifts/${g.id}`, { isActive: true })),
    onSuccess: (_res, g) => {
      showToast(g.isActive ? t('admin.gifts.retired', 'Gift retired') : t('admin.gifts.restored', 'Gift restored'));
      qc.invalidateQueries({ queryKey: ['admin', 'gifts'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const handleSubmit = () => {
    if (!form.name.trim() || !form.emoji.trim() || isNaN(parseInt(form.coinCost, 10)) || isNaN(parseInt(form.tier, 10))) {
      showToast(t('admin.gifts.formError', 'Name, emoji, coin cost, and tier are required'), 'error');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.gifts', 'Gifts Catalog')}</h1>
        <button type="button" onClick={openCreate} className="shrink-0 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-neutral-900">
          {t('admin.gifts.new', '+ New Gift')}
        </button>
      </div>
      <label className="mb-4 flex items-center gap-2 text-sm text-neutral-600">
        <AdminToggle checked={showRetired} onChange={setShowRetired} />
        {t('admin.gifts.showRetired', 'Show retired')}
      </label>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (gifts?.length ?? 0) === 0 && <AdminEmptyState icon="🎀" title={t('admin.gifts.empty', 'No gifts found')} />}
        {status === 'success' &&
          gifts?.map((g) => (
            <AdminCard key={g.id}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{g.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900">{g.name}</p>
                    <AdminBadge label={`T${g.tier}`} color={TIER_COLOR[g.tier] ?? 'neutral'} />
                    {!g.isActive && <AdminBadge label={t('admin.gifts.retiredBadge', 'Retired')} color="red" />}
                  </div>
                  <p className="text-xs text-neutral-500">{fmtNumber(g.coinCost)} {t('admin.gifts.coins', { defaultValue: '{{currency}}', currency: currency.softPlural.toLowerCase() })}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => openEdit(g)} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {t('admin.gifts.edit', 'Edit')}
                  </button>
                  <button
                    type="button"
                    disabled={retireMutation.isPending}
                    onClick={() => retireMutation.mutate(g)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${g.isActive ? 'bg-danger-100 text-danger-700' : 'bg-success-100 text-success-700'}`}
                  >
                    {g.isActive ? t('admin.gifts.retire', 'Retire') : t('admin.gifts.restore', 'Restore')}
                  </button>
                </div>
              </div>
            </AdminCard>
          ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 max-h-[85vh] overflow-y-auto">
            <h3 className="mb-4 font-semibold text-neutral-900">
              {editTarget ? t('admin.gifts.editTitle', 'Edit "{{name}}"', { name: editTarget.name }) : t('admin.gifts.newTitle', 'New Gift Item')}
            </h3>
            <div className="space-y-3">
              <AdminField label={t('admin.gifts.name', 'Name')}>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={adminInputClass} placeholder="e.g. Rose" />
              </AdminField>
              <AdminField label={t('admin.gifts.emoji', 'Emoji')}>
                <input value={form.emoji} onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))} className={adminInputClass} placeholder="🌹" maxLength={10} />
              </AdminField>
              <div className="grid grid-cols-2 gap-2">
                <AdminField label={t('admin.gifts.coinCost', 'Coin Cost')}>
                  <input type="number" min="1" value={form.coinCost} onChange={(e) => setForm((f) => ({ ...f, coinCost: e.target.value }))} className={adminInputClass} />
                </AdminField>
                <AdminField label={t('admin.gifts.tier', 'Tier (1–5)')}>
                  <select value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))} className={adminInputClass}>
                    {[1, 2, 3, 4, 5].map((tv) => (
                      <option key={tv} value={tv}>T{tv}</option>
                    ))}
                  </select>
                </AdminField>
              </div>
              <AdminField label={t('admin.gifts.animationUrl', 'Animation URL (optional)')}>
                <input value={form.animationUrl} onChange={(e) => setForm((f) => ({ ...f, animationUrl: e.target.value }))} className={adminInputClass} placeholder="https://…" />
              </AdminField>
              <AdminField label={t('admin.gifts.spectacleThreshold', 'Spectacle threshold coins (optional)')}>
                <input type="number" min="1" value={form.spectacleThresholdCoins} onChange={(e) => setForm((f) => ({ ...f, spectacleThresholdCoins: e.target.value }))} className={adminInputClass} />
              </AdminField>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium text-neutral-700">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saveMutation.isPending}
                className="flex-1 rounded-lg bg-amber-400 py-2 text-sm font-bold text-neutral-900 disabled:opacity-50"
              >
                {saveMutation.isPending ? '…' : editTarget ? t('admin.gifts.saveChanges', 'Save Changes') : t('admin.gifts.create', 'Create Gift')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/gifts')({
  component: AdminGiftsPage,
});
