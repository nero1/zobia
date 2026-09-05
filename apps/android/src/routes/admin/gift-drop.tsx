/**
 * apps/android/src/routes/admin/gift-drop.tsx
 *
 * Monthly Mystery Gift Drop — mirrors apps/web/app/(admin)/admin/gift-drop/page.tsx.
 * GET /admin/gift-drop -> { drops }, POST /admin/gift-drop { giftItemId, startAt }.
 * Gift item dropdown from GET /economy/gifts/catalogue -> { tiers: [{ gifts }] }
 * (flattened — see the web page fix in this same change: the old web code read
 * a top-level `items`/`gifts` key that doesn't exist on this tiered response).
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
  AdminField,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

interface GiftDrop {
  id: string;
  gift_item_id: string;
  title: string;
  available_from: string;
  available_until: string;
  announced_at: string | null;
  gift_item_name: string | null;
  gift_item_retired: boolean | null;
}

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  tier: number;
  coinCost: number;
}

function dropStatus(drop: GiftDrop, t: (k: string, d: string) => string): { label: string; color: 'blue' | 'green' | 'neutral' } {
  const now = new Date();
  const from = new Date(drop.available_from);
  const until = new Date(drop.available_until);
  if (now < from) return { label: t('admin.giftDrop.upcoming', 'Upcoming'), color: 'blue' };
  if (now >= from && now <= until) return { label: t('admin.giftDrop.active', 'Active'), color: 'green' };
  return { label: t('admin.giftDrop.ended', 'Ended'), color: 'neutral' };
}

async function fetchDrops(): Promise<GiftDrop[]> {
  const { data } = await apiClient.get<{ drops: GiftDrop[] }>('/admin/gift-drop');
  return data?.drops ?? [];
}

async function fetchGiftItems(): Promise<GiftItem[]> {
  const { data } = await apiClient.get<{ tiers?: { gifts: GiftItem[] }[] }>('/economy/gifts/catalogue');
  return (data?.tiers ?? []).flatMap((t) => t.gifts);
}

function AdminGiftDropPage() {
  const { t } = useTranslation();
  const currency = useCurrency();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [giftItemId, setGiftItemId] = useState('');
  const defaultStartAt = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16);
  const [startAt, setStartAt] = useState(defaultStartAt);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: drops, status, refetch } = useQuery({ queryKey: ['admin', 'gift-drop'], queryFn: fetchDrops });
  const { data: giftItems } = useQuery({ queryKey: ['admin', 'gift-drop', 'items'], queryFn: fetchGiftItems, enabled: showForm });

  const create = useMutation({
    mutationFn: () => apiClient.post('/admin/gift-drop', { giftItemId, startAt: new Date(startAt).toISOString() }),
    onSuccess: () => {
      showToast(t('admin.giftDrop.scheduled', 'Gift drop scheduled'));
      setShowForm(false);
      setGiftItemId('');
      setStartAt(defaultStartAt);
      qc.invalidateQueries({ queryKey: ['admin', 'gift-drop'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.giftDrop', 'Monthly Mystery Gift Drop')}</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
        >
          {showForm ? t('common.cancel') : t('admin.giftDrop.schedule', '+ Schedule Drop')}
        </button>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        {t('admin.giftDrop.subtitle', 'Limited-edition gifts available for 48 hours only — announced 24 hours in advance, then retired permanently.')}
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      {showForm && (
        <AdminCard>
          <div className="space-y-3">
            <AdminField label={t('admin.giftDrop.giftItem', 'Gift Item')}>
              <select value={giftItemId} onChange={(e) => setGiftItemId(e.target.value)} className={adminInputClass}>
                <option value="">{t('admin.giftDrop.selectItem', 'Select a gift item…')}</option>
                {giftItems?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.emoji} {g.name} — {g.coinCost.toLocaleString()} {currency.softPlural.toLowerCase()} (T{g.tier})
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label={t('admin.giftDrop.availableFrom', 'Available From (announced 24h before, ends 48h later)')}>
              <input
                type="datetime-local"
                value={startAt}
                min={new Date().toISOString().slice(0, 16)}
                onChange={(e) => setStartAt(e.target.value)}
                className={adminInputClass}
              />
            </AdminField>
            <button
              type="button"
              disabled={!giftItemId || !startAt || create.isPending}
              onClick={() => create.mutate()}
              className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {create.isPending ? '…' : t('admin.giftDrop.schedule', '+ Schedule Drop')}
            </button>
          </div>
        </AdminCard>
      )}

      <div className="mt-4 space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (drops?.length ?? 0) === 0 && (
          <AdminEmptyState icon="🎁" title={t('admin.giftDrop.empty', 'No gift drops scheduled yet')} />
        )}
        {status === 'success' &&
          drops?.map((drop) => {
            const s = dropStatus(drop, t);
            return (
              <AdminCard key={drop.id}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold text-neutral-900">
                    {drop.gift_item_name ?? drop.gift_item_id.slice(0, 8)}
                    {drop.gift_item_retired && <span className="ml-1.5"><AdminBadge label={t('admin.giftDrop.retired', 'Retired')} color="red" /></span>}
                  </p>
                  <AdminBadge label={s.label} color={s.color} />
                </div>
                <p className="mt-1.5 text-xs text-neutral-500">{t('admin.giftDrop.from', 'From')}: {fmtDate(drop.available_from)}</p>
                <p className="text-xs text-neutral-500">{t('admin.giftDrop.until', 'Until')}: {fmtDate(drop.available_until)}</p>
                {drop.announced_at && <p className="text-xs text-neutral-400">{t('admin.giftDrop.announced', 'Announced')}: {fmtDate(drop.announced_at)}</p>}
              </AdminCard>
            );
          })}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/gift-drop')({
  component: AdminGiftDropPage,
});
