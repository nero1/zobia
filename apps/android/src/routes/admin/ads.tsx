/**
 * apps/android/src/routes/admin/ads.tsx
 *
 * Ad control panel — mirrors apps/web/app/(admin)/admin/ads/page.tsx (PRD
 * §17 Pillar 3 — Platform Advertising). Tabs: platform revenue/performance
 * overview, the moderation approval queue, the ad slot (placement)
 * catalogue, and the coupon system.
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
  AdminToast,
  AdminTabs,
  AdminStatCard,
  AdminConfirmDialog,
  adminInputClass,
  fmtNumber,
} from '@/components/admin/AdminUI';

type TabKey = 'overview' | 'moderation' | 'placements' | 'coupons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverviewData {
  activeCampaigns: number;
  totalSpendCredits: string;
  totalBudgetCredits: string;
  pendingModeration: number;
  topCampaigns: { id: string; name: string; spent_credits: string; advertiser_name: string | null }[];
}

interface AdCampaign {
  id: string;
  name: string;
  objective: string;
  advertiser_name: string | null;
  cpm_credits: string;
  total_budget_credits: string;
}

interface Placement {
  key: string;
  label: string;
  size: string;
  is_active: boolean;
  base_cpm_credits: string;
}

interface Coupon {
  id: string;
  code: string;
  discount_type: string;
  discount_value: string;
  redemptions_count: number;
  max_redemptions: number | null;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab() {
  const { t } = useTranslation();
  const { data, status } = useQuery({
    queryKey: ['admin', 'ads', 'stats'],
    queryFn: async () => (await apiClient.get<OverviewData>('/admin/ads/stats')).data,
  });

  if (status === 'pending') return <div className="grid grid-cols-2 gap-2.5">{Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}</div>;
  if (status === 'error' || !data) return <AdminEmptyState icon="⚠️" title={t('error.generic')} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <AdminStatCard label={t('admin.ads.activeCampaigns', 'Active Campaigns')} value={fmtNumber(data.activeCampaigns)} color="blue" />
        <AdminStatCard label={t('admin.ads.pendingReview', 'Pending Review')} value={fmtNumber(data.pendingModeration)} color={data.pendingModeration > 0 ? 'red' : 'neutral'} />
        <AdminStatCard label={t('admin.ads.totalSpend', 'Total Spend (Credits)')} value={fmtNumber(Number(data.totalSpendCredits))} color="gold" />
        <AdminStatCard label={t('admin.ads.totalBudget', 'Total Budget (Credits)')} value={fmtNumber(Number(data.totalBudgetCredits))} color="green" />
      </div>
      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.ads.topCampaigns', 'Top campaigns by spend')}</h2>
        {data.topCampaigns.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('admin.ads.noSpend', 'No spend yet.')}</p>
        ) : (
          <div className="space-y-1.5">
            {data.topCampaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-800">{c.name}</p>
                  <p className="truncate text-xs text-neutral-500">{c.advertiser_name}</p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-neutral-700">{fmtNumber(Number(c.spent_credits))} Cr</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moderation tab
// ---------------------------------------------------------------------------

function ModerationTab({ notify }: { notify: (msg: string, type?: 'success' | 'error') => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<AdCampaign | null>(null);
  const [reason, setReason] = useState('');

  const { data, status } = useQuery({
    queryKey: ['admin', 'ads', 'campaigns', 'pending'],
    queryFn: async () => (await apiClient.get<{ campaigns: AdCampaign[] }>('/admin/ads/campaigns?moderationStatus=pending')).data?.campaigns ?? [],
  });

  const moderate = useMutation({
    mutationFn: ({ id, action, reasonText }: { id: string; action: 'approve' | 'reject'; reasonText?: string }) =>
      apiClient.post(`/admin/ads/campaigns/${id}/moderate`, { action, reason: reasonText }),
    onSuccess: () => {
      notify(t('admin.moderation.actionApplied', 'Action applied'));
      setRejecting(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin', 'ads', 'campaigns', 'pending'] });
    },
    onError: () => notify(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="space-y-2.5">
      {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
      {status === 'success' && (data?.length ?? 0) === 0 && <AdminEmptyState icon="✓" title={t('admin.ads.noPending', 'No campaigns pending review')} />}
      {status === 'success' &&
        data?.map((c) => (
          <AdminCard key={c.id}>
            <p className="font-semibold text-neutral-900">{c.name}</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {c.advertiser_name} · {c.objective} · CPM {c.cpm_credits} Cr · {t('admin.ads.budget', 'Budget')} {fmtNumber(Number(c.total_budget_credits))} Cr
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                disabled={moderate.isPending}
                onClick={() => moderate.mutate({ id: c.id, action: 'approve' })}
                className="rounded-lg bg-success-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {t('admin.ads.approve', 'Approve')}
              </button>
              <button type="button" disabled={moderate.isPending} onClick={() => setRejecting(c)} className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {t('admin.ads.reject', 'Reject')}
              </button>
            </div>
          </AdminCard>
        ))}

      {rejecting && (
        <AdminConfirmDialog
          title={t('admin.ads.rejectTitle', 'Reject "{{name}}"?', { name: rejecting.name })}
          confirmLabel={t('admin.ads.reject', 'Reject')}
          cancelLabel={t('common.cancel')}
          danger
          pending={moderate.isPending}
          onCancel={() => { setRejecting(null); setReason(''); }}
          onConfirm={() => moderate.mutate({ id: rejecting.id, action: 'reject', reasonText: reason.trim() || undefined })}
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('admin.ads.rejectReasonPlaceholder', 'Rejection reason (optional)…')}
            rows={2}
            className={`${adminInputClass} resize-none text-sm`}
          />
        </AdminConfirmDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placements tab
// ---------------------------------------------------------------------------

function PlacementsTab({ notify }: { notify: (msg: string, type?: 'success' | 'error') => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, status } = useQuery({
    queryKey: ['admin', 'ads', 'placements'],
    queryFn: async () => (await apiClient.get<{ placements: Placement[] }>('/admin/ads/placements')).data?.placements ?? [],
  });

  const patch = useMutation({
    mutationFn: ({ key, body }: { key: string; body: Record<string, unknown> }) => apiClient.patch(`/admin/ads/placements/${key}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'ads', 'placements'] }),
    onError: () => notify(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="space-y-2">
      {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
      {status === 'success' && (data?.length ?? 0) === 0 && <AdminEmptyState icon="🖼️" title={t('admin.ads.noPlacements', 'No ad slots configured')} />}
      {status === 'success' &&
        data?.map((p) => (
          <AdminCard key={p.key}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-900">{p.label}</p>
                <p className="text-xs text-neutral-500">{p.key} · {p.size}</p>
              </div>
              <button
                type="button"
                onClick={() => patch.mutate({ key: p.key, body: { isActive: !p.is_active } })}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${p.is_active ? 'bg-success-100 text-success-700' : 'bg-neutral-200 text-neutral-500'}`}
              >
                {p.is_active ? t('admin.events.active', 'Active') : t('admin.events.inactive', 'Inactive')}
              </button>
            </div>
            <label className="mt-2.5 block">
              <span className="mb-1 block text-[11px] font-semibold text-neutral-500">{t('admin.ads.baseCpm', 'Base CPM (Credits / 1000 impressions)')}</span>
              <input
                type="number"
                defaultValue={p.base_cpm_credits}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) patch.mutate({ key: p.key, body: { baseCpmCredits: n } });
                }}
                className={`${adminInputClass} text-sm`}
              />
            </label>
          </AdminCard>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coupons tab
// ---------------------------------------------------------------------------

function CouponsTab({ notify }: { notify: (msg: string, type?: 'success' | 'error') => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'flat_credits' | 'free_credits'>('flat_credits');
  const [discountValue, setDiscountValue] = useState('1000');
  const [maxRedemptions, setMaxRedemptions] = useState('');

  const { data, status } = useQuery({
    queryKey: ['admin', 'ads', 'coupons'],
    queryFn: async () => (await apiClient.get<{ coupons: Coupon[] }>('/admin/ads/coupons')).data?.coupons ?? [],
  });

  const create = useMutation({
    mutationFn: () =>
      apiClient.post('/admin/ads/coupons', {
        code: code.trim(),
        discountType,
        discountValue: Number(discountValue),
        maxRedemptions: maxRedemptions === '' ? undefined : Number(maxRedemptions),
      }),
    onSuccess: () => {
      notify(t('admin.ads.couponCreated', 'Coupon created'));
      setCode('');
      qc.invalidateQueries({ queryKey: ['admin', 'ads', 'coupons'] });
    },
    onError: () => notify(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiClient.patch(`/admin/ads/coupons/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'ads', 'coupons'] }),
    onError: () => notify(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
        <p className="mb-3 text-sm font-semibold text-neutral-900">{t('admin.ads.createCoupon', 'Create Coupon')}</p>
        <div className="space-y-2.5">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('admin.ads.couponCode', 'CODE')} className={adminInputClass} />
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)} className={adminInputClass}>
            <option value="flat_credits">{t('admin.ads.flatCredits', 'Flat Credits')}</option>
            <option value="percent">{t('admin.ads.percentOff', 'Percent off budget')}</option>
            <option value="free_credits">{t('admin.ads.freeCredits', 'Free Credits')}</option>
          </select>
          <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder={t('admin.ads.discountValue', 'Discount value')} className={adminInputClass} />
          <input type="number" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder={t('admin.ads.maxRedemptions', 'Max redemptions (optional)')} className={adminInputClass} />
        </div>
        <button
          type="button"
          disabled={create.isPending || !code.trim()}
          onClick={() => create.mutate()}
          className="mt-3 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {create.isPending ? '…' : t('admin.ads.create', 'Create')}
        </button>
      </div>

      <div className="space-y-2">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'success' && (data?.length ?? 0) === 0 && <AdminEmptyState icon="🎟️" title={t('admin.ads.noCoupons', 'No coupons yet')} />}
        {status === 'success' &&
          data?.map((c) => (
            <AdminCard key={c.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900">{c.code}</p>
                  <p className="text-xs text-neutral-500">{c.discount_type} · {c.discount_value} · {c.redemptions_count}/{c.max_redemptions ?? '∞'} {t('admin.ads.redeemed', 'redeemed')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: c.id, isActive: !c.is_active })}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${c.is_active ? 'bg-success-100 text-success-700' : 'bg-neutral-200 text-neutral-500'}`}
                >
                  {c.is_active ? t('admin.events.active', 'Active') : t('admin.events.inactive', 'Inactive')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AdminAdsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('overview');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const tabs = [
    { key: 'overview' as const, label: t('admin.ads.tab.overview', 'Overview') },
    { key: 'moderation' as const, label: t('admin.ads.tab.moderation', 'Moderation') },
    { key: 'placements' as const, label: t('admin.ads.tab.placements', 'Placements') },
    { key: 'coupons' as const, label: t('admin.ads.tab.coupons', 'Coupons') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.ads', 'Ads')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}
      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab />}
      {tab === 'moderation' && <ModerationTab notify={notify} />}
      {tab === 'placements' && <PlacementsTab notify={notify} />}
      {tab === 'coupons' && <CouponsTab notify={notify} />}
    </div>
  );
}

export const Route = createFileRoute('/admin/ads')({
  component: AdminAdsPage,
});
