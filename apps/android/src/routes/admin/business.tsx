/**
 * apps/android/src/routes/admin/business.tsx
 *
 * Business Accounts admin — mirrors apps/web/app/(admin)/admin/business/page.tsx
 * (verification queue + suspend/restore) and apps/web/app/(admin)/admin/business/pages/page.tsx
 * (Business Pages moderation). The web nav lists these as two separate pages, but
 * adminNav.ts only has one "/admin/business" entry, so both live here as tabs
 * ("Accounts" / "Pages") — the native-mobile equivalent of the web's in-page link.
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
  AdminTabs,
  AdminConfirmDialog,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

type TabKey = 'accounts' | 'pages';
type VerFilter = 'all' | 'pending' | 'verified' | 'rejected' | 'unverified';
type TierFilter = 'all' | 'starter' | 'growth' | 'enterprise';
type PageStatusFilter = 'all' | 'active' | 'deactivated' | 'suspended' | 'banned';
type AccountAction = 'verify' | 'reject' | 'suspend' | 'restore';
type PageAction = 'suspend' | 'ban' | 'deactivate' | 'restore' | 'delete';

interface BusinessAccount {
  id: string;
  user_id: string;
  username: string;
  email: string | null;
  business_name: string;
  business_type: string | null;
  tier: string;
  status: string;
  verification_status: string;
  verification_requested_at: string | null;
  verified: boolean;
  created_at: string;
}

interface BusinessPage {
  id: string;
  business_account_id: string;
  slug: string;
  name: string;
  status: string;
  status_reason: string | null;
  view_count: number;
  post_count: number;
  created_at: string;
  business_name: string;
  owner_username: string;
}

const TIER_COLOR: Record<string, 'neutral' | 'blue' | 'gold'> = { starter: 'neutral', growth: 'blue', enterprise: 'gold' };
const VER_COLOR: Record<string, 'neutral' | 'gold' | 'green' | 'red'> = { unverified: 'neutral', pending: 'gold', verified: 'green', rejected: 'red' };
const STATUS_COLOR: Record<string, 'green' | 'red' | 'neutral' | 'gold'> = {
  active: 'green',
  suspended: 'red',
  deactivated: 'neutral',
  banned: 'red',
};

async function fetchBusinesses(page: number, verFilter: VerFilter, tierFilter: TierFilter): Promise<{ businesses: BusinessAccount[]; total: number }> {
  const params = new URLSearchParams({ page: String(page) });
  if (verFilter !== 'all') params.set('verification_status', verFilter);
  if (tierFilter !== 'all') params.set('tier', tierFilter);
  const { data } = await apiClient.get<{ businesses: BusinessAccount[]; total: number }>(`/admin/business?${params}`);
  return { businesses: data?.businesses ?? [], total: data?.total ?? 0 };
}

async function fetchPages(page: number, statusFilter: PageStatusFilter): Promise<{ pages: BusinessPage[]; total: number }> {
  const params = new URLSearchParams({ page: String(page) });
  if (statusFilter !== 'all') params.set('status', statusFilter);
  const { data } = await apiClient.get<{ pages: BusinessPage[]; total: number }>(`/admin/business/pages?${params}`);
  return { pages: data?.pages ?? [], total: data?.total ?? 0 };
}

function FilterChips<T extends string>({ options, active, onChange, labels }: { options: T[]; active: T; onChange: (v: T) => void; labels: Record<T, string> }) {
  return (
    <div className="mb-2.5 flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${active === o ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts tab
// ---------------------------------------------------------------------------

function AccountsTab({ showToast }: { showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [verFilter, setVerFilter] = useState<VerFilter>('all');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [page, setPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<BusinessAccount | null>(null);
  const [reason, setReason] = useState('');

  const { data, status, refetch } = useQuery({
    queryKey: ['admin', 'business', 'accounts', page, verFilter, tierFilter],
    queryFn: () => fetchBusinesses(page, verFilter, tierFilter),
  });

  const action = useMutation({
    mutationFn: ({ id, actionType, actionReason }: { id: string; actionType: AccountAction; actionReason?: string }) =>
      apiClient.patch('/admin/business', { id, action: actionType, reason: actionReason }),
    onSuccess: () => {
      showToast(t('admin.business.actionApplied', 'Action applied'));
      qc.invalidateQueries({ queryKey: ['admin', 'business', 'accounts'] });
      setRejectTarget(null);
      setReason('');
    },
    onError: () => showToast(t('admin.business.actionFailed', 'Action failed'), 'error'),
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  const verLabels: Record<VerFilter, string> = {
    all: t('admin.business.filters.all', 'All'),
    pending: t('admin.business.filters.pending', 'Pending Verification'),
    verified: t('admin.business.filters.verified', 'Verified'),
    rejected: t('admin.business.filters.rejected', 'Rejected'),
    unverified: t('admin.business.filters.unverified', 'Unverified'),
  };
  const tierLabels: Record<TierFilter, string> = {
    all: t('admin.business.filters.all', 'All'),
    starter: t('admin.business.tier.starter', 'Starter'),
    growth: t('admin.business.tier.growth', 'Growth'),
    enterprise: t('admin.business.tier.enterprise', 'Enterprise'),
  };

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('admin.business.filters.tier', 'Filter by tier')}</p>
      <FilterChips options={['all', 'pending', 'verified', 'rejected', 'unverified']} active={verFilter} onChange={(v) => { setVerFilter(v); setPage(1); }} labels={verLabels} />
      <FilterChips options={['all', 'starter', 'growth', 'enterprise']} active={tierFilter} onChange={(v) => { setTierFilter(v); setPage(1); }} labels={tierLabels} />

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && data.businesses.length === 0 && <AdminEmptyState icon="🏢" title={t('admin.business.empty', 'No business accounts found')} />}

        {status === 'success' &&
          data.businesses.map((biz) => (
            <AdminCard key={biz.id}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <p className="font-semibold text-neutral-900">{biz.business_name}</p>
                <AdminBadge label={biz.tier} color={TIER_COLOR[biz.tier] ?? 'neutral'} />
                <AdminBadge label={biz.verification_status} color={VER_COLOR[biz.verification_status] ?? 'neutral'} />
                <AdminBadge label={biz.status} color={biz.status === 'active' ? 'green' : 'red'} />
              </div>
              {biz.business_type && <p className="mb-0.5 text-xs capitalize text-neutral-400">{biz.business_type}</p>}
              <p className="mb-0.5 text-xs text-neutral-500">@{biz.username}{biz.email ? ` · ${biz.email}` : ''}</p>
              <p className="mb-2.5 text-[10px] text-neutral-400">
                {t('admin.business.table.created', 'Created')}: {fmtDate(biz.created_at)}
                {biz.verification_requested_at ? ` · ${t('admin.business.table.verification', 'Verification')} ${fmtDate(biz.verification_requested_at)}` : ''}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {biz.verification_status === 'pending' && (
                  <>
                    <button
                      type="button"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: biz.id, actionType: 'verify' })}
                      className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700 disabled:opacity-50"
                    >
                      {t('admin.business.action.verify', 'Verify')}
                    </button>
                    <button
                      type="button"
                      disabled={action.isPending}
                      onClick={() => { setRejectTarget(biz); setReason(''); }}
                      className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50"
                    >
                      {t('admin.business.action.reject', 'Reject')}
                    </button>
                  </>
                )}
                {biz.status === 'active' ? (
                  <button
                    type="button"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: biz.id, actionType: 'suspend' })}
                    className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                  >
                    {t('admin.business.action.suspend', 'Suspend')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: biz.id, actionType: 'restore' })}
                    className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                  >
                    {t('admin.business.action.restore', 'Restore')}
                  </button>
                )}
              </div>
            </AdminCard>
          ))}
      </div>

      {status === 'success' && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">
            {t('admin.pagination.prev', 'Prev')}
          </button>
          <span className="text-xs text-neutral-500">{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">
            {t('admin.pagination.next', 'Next')}
          </button>
        </div>
      )}

      {rejectTarget && (
        <AdminConfirmDialog
          title={t('admin.business.action.reject', 'Reject')}
          description={t('admin.business.rejectHint', 'Optionally provide a reason shown to the business owner.')}
          confirmLabel={t('admin.business.action.confirm', 'Confirm')}
          cancelLabel={t('admin.business.action.cancel', 'Cancel')}
          danger
          pending={action.isPending}
          onCancel={() => { setRejectTarget(null); setReason(''); }}
          onConfirm={() => action.mutate({ id: rejectTarget.id, actionType: 'reject', actionReason: reason.trim() || undefined })}
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('admin.business.action.rejectReason', 'Rejection Reason (optional)')}
            rows={3}
            className={`${adminInputClass} resize-none text-sm`}
          />
        </AdminConfirmDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pages tab
// ---------------------------------------------------------------------------

function PagesTab({ showToast }: { showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<PageStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [confirmTarget, setConfirmTarget] = useState<{ page: BusinessPage; action: PageAction } | null>(null);
  const [reason, setReason] = useState('');

  const { data, status, refetch } = useQuery({
    queryKey: ['admin', 'business', 'pages', page, statusFilter],
    queryFn: () => fetchPages(page, statusFilter),
  });

  const action = useMutation({
    mutationFn: ({ id, actionType, actionReason }: { id: string; actionType: PageAction; actionReason?: string }) =>
      apiClient.patch('/admin/business/pages', { id, action: actionType, reason: actionReason }),
    onSuccess: () => {
      showToast(t('admin.business.actionApplied', 'Action applied'));
      qc.invalidateQueries({ queryKey: ['admin', 'business', 'pages'] });
      setConfirmTarget(null);
      setReason('');
    },
    onError: () => showToast(t('admin.business.actionFailed', 'Action failed'), 'error'),
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  const statusLabels: Record<PageStatusFilter, string> = {
    all: t('admin.business.filters.all', 'All'),
    active: t('admin.rooms.status.active', 'Active'),
    deactivated: t('admin.business.pages.status.deactivated', 'Deactivated'),
    suspended: t('admin.rooms.status.suspended', 'Suspended'),
    banned: t('admin.rooms.status.banned', 'Banned'),
  };

  return (
    <div>
      <FilterChips options={['all', 'active', 'deactivated', 'suspended', 'banned']} active={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} labels={statusLabels} />

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && data.pages.length === 0 && <AdminEmptyState icon="📄" title={t('admin.business.pages.empty', 'No business pages found')} />}

        {status === 'success' &&
          data.pages.map((p) => (
            <AdminCard key={p.id}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <p className="font-semibold text-neutral-900">{p.name}</p>
                <AdminBadge label={p.status} color={STATUS_COLOR[p.status] ?? 'neutral'} />
              </div>
              <p className="mb-0.5 text-xs text-neutral-400">/p/{p.slug}</p>
              <p className="mb-0.5 text-xs text-neutral-500">{p.business_name} · @{p.owner_username}</p>
              <p className="mb-1.5 text-xs text-neutral-500">👁 {p.view_count.toLocaleString()} · 📝 {p.post_count.toLocaleString()} · {fmtDate(p.created_at)}</p>
              {p.status_reason && <p className="mb-2 text-xs text-neutral-400">{p.status_reason}</p>}
              <div className="flex flex-wrap gap-1.5">
                {p.status === 'active' ? (
                  <>
                    <button
                      type="button"
                      disabled={action.isPending}
                      onClick={() => { setConfirmTarget({ page: p, action: 'suspend' }); setReason(''); }}
                      className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                    >
                      {t('admin.rooms.suspend', 'Suspend')}
                    </button>
                    <button
                      type="button"
                      disabled={action.isPending}
                      onClick={() => { setConfirmTarget({ page: p, action: 'ban' }); setReason(''); }}
                      className="rounded-lg bg-danger-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {t('admin.rooms.ban', 'Ban')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: p.id, actionType: 'restore' })}
                    className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700 disabled:opacity-50"
                  >
                    {t('admin.business.action.restore', 'Restore')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() => { setConfirmTarget({ page: p, action: 'delete' }); setReason(''); }}
                  className="rounded-lg border border-danger-300 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50"
                >
                  {t('admin.rooms.delete', 'Delete')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>

      {status === 'success' && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={page <= 1} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">
            {t('admin.pagination.prev', 'Prev')}
          </button>
          <span className="text-xs text-neutral-500">{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((v) => Math.min(totalPages, v + 1))} disabled={page >= totalPages} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">
            {t('admin.pagination.next', 'Next')}
          </button>
        </div>
      )}

      {confirmTarget && (
        <AdminConfirmDialog
          title={t(`admin.business.pages.${confirmTarget.action}`, confirmTarget.action)}
          description={t('admin.business.rejectHint', 'Optionally provide a reason shown to the business owner.')}
          confirmLabel={t('admin.business.action.confirm', 'Confirm')}
          cancelLabel={t('admin.business.action.cancel', 'Cancel')}
          danger
          pending={action.isPending}
          onCancel={() => { setConfirmTarget(null); setReason(''); }}
          onConfirm={() => action.mutate({ id: confirmTarget.page.id, actionType: confirmTarget.action, actionReason: reason.trim() || undefined })}
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('admin.business.action.rejectReason', 'Reason (optional)')}
            rows={3}
            className={`${adminInputClass} resize-none text-sm`}
          />
        </AdminConfirmDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function AdminBusinessPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('accounts');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const tabs = [
    { key: 'accounts' as const, label: t('admin.business.title', 'Business Accounts') },
    { key: 'pages' as const, label: t('admin.business.pages.tab', 'Business Pages') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.business', 'Business Accounts')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'accounts' ? <AccountsTab showToast={showToast} /> : <PagesTab showToast={showToast} />}
    </div>
  );
}

export const Route = createFileRoute('/admin/business')({
  component: AdminBusinessPage,
});
