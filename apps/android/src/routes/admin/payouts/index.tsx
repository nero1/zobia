/**
 * apps/android/src/routes/admin/payouts/index.tsx
 *
 * Creator payout management — mirrors apps/web/app/(admin)/admin/payouts/page.tsx:
 * Awaiting Approval / Approved / Rejected tabs plus a Dead-Letter Queue tab.
 *
 * BUG FIX (see apps/web/app/api/admin/payouts/route.ts + page.tsx in this
 * same change): GET /api/admin/payouts uses keyset (cursor) pagination and
 * never returned a `total` field or `bankAccountLast4` (the column existed
 * on creator_payouts but the route's SELECT omitted it) — the web page read
 * both and always got `undefined`. Fixed the route to select
 * bank_account_last4 and this page to use hasMore/nextCursor instead of a
 * nonexistent total.
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
  AdminTabs,
  AdminBadge,
  AdminConfirmDialog,
  adminInputClass,
  fmtCurrency,
  fmtDate,
  timeAgo,
} from '@/components/admin/AdminUI';

type TabKey = 'awaiting_approval' | 'approved' | 'rejected' | 'dlq';

interface Payout {
  id: string;
  creator: { id: string; username: string; email: string | null };
  grossKobo: number;
  netKobo: number;
  status: string;
  method: string;
  bankAccountLast4: string | null;
  createdAt: string;
}

interface DlqItem {
  id: string;
  payoutId: string;
  creator: { id: string; username: string; email: string | null };
  failureReason: string | null;
  retryCount: number;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  payout: { grossKobo: number; netKobo: number; method: string; status: string };
}

function koboToNgn(kobo: number): number {
  return kobo / 100;
}

const STATUS_BADGE: Record<string, 'gold' | 'teal' | 'blue' | 'red'> = {
  awaiting_approval: 'gold',
  pending: 'blue',
  processing: 'blue',
  completed: 'teal',
  rejected: 'red',
  failed: 'red',
};

async function fetchPayouts(tab: TabKey): Promise<{ payouts: Payout[]; dlqItems: DlqItem[]; dlqTotal: number }> {
  if (tab === 'dlq') {
    const { data } = await apiClient.get<{ items: DlqItem[]; total: number }>('/admin/payouts/dlq?limit=50&offset=0');
    return { payouts: [], dlqItems: data?.items ?? [], dlqTotal: data?.total ?? 0 };
  }
  const { data } = await apiClient.get<{ payouts: Payout[] }>(`/admin/payouts?status=${tab}&limit=50`);
  return { payouts: data?.payouts ?? [], dlqItems: [], dlqTotal: 0 };
}

function PayoutCard({ payout, showActions, onApprove, onReject, busy }: {
  payout: Payout;
  showActions: boolean;
  onApprove: (id: string) => void;
  onReject: (payout: Payout) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AdminCard>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-neutral-900">@{payout.creator.username}</p>
          {payout.creator.email && <p className="truncate text-xs text-neutral-400">{payout.creator.email}</p>}
        </div>
        <AdminBadge label={payout.status.replace(/_/g, ' ')} color={STATUS_BADGE[payout.status] ?? 'blue'} />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="font-bold text-neutral-900">{fmtCurrency(koboToNgn(payout.netKobo))}</span>
        <span className="text-xs text-neutral-400">{t('admin.payouts.gross', 'gross')} {fmtCurrency(koboToNgn(payout.grossKobo))}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-500">
        <span>{payout.method.replace(/_/g, ' ')}{payout.bankAccountLast4 ? ` · ••••${payout.bankAccountLast4}` : ''}</span>
        <span>{timeAgo(payout.createdAt)}</span>
      </div>
      {showActions && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onApprove(payout.id)}
            className="flex-1 rounded-lg bg-success-100 px-3 py-2 text-xs font-semibold text-success-700 disabled:opacity-50"
          >
            {t('admin.payouts.approve', 'Approve')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(payout)}
            className="flex-1 rounded-lg bg-danger-100 px-3 py-2 text-xs font-semibold text-danger-700 disabled:opacity-50"
          >
            {t('admin.payouts.reject', 'Reject')}
          </button>
        </div>
      )}
    </AdminCard>
  );
}

function DlqCard({ item, onRetry, busy }: { item: DlqItem; onRetry: (id: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const resolved = !!item.resolvedAt;
  return (
    <AdminCard>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-neutral-900">@{item.creator.username}</p>
          {item.creator.email && <p className="truncate text-xs text-neutral-400">{item.creator.email}</p>}
        </div>
        <AdminBadge label={resolved ? t('admin.payouts.resolved', 'Resolved') : t('admin.payouts.unresolved', 'Unresolved')} color={resolved ? 'teal' : 'red'} />
      </div>
      <p className="mt-2 font-bold text-neutral-900">{fmtCurrency(koboToNgn(item.payout.grossKobo))}</p>
      {item.failureReason && <p className="mt-1 truncate text-xs text-danger-700">{item.failureReason}</p>}
      <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-500">
        <span>{t('admin.payouts.retries', 'Retries')}: {item.retryCount}</span>
        <span>{timeAgo(item.createdAt)}</span>
      </div>
      {resolved ? (
        item.resolutionNote && <p className="mt-2 text-[11px] italic text-neutral-400">{item.resolutionNote}</p>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRetry(item.id)}
          className="mt-3 w-full rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-700 disabled:opacity-50"
        >
          {t('admin.payouts.requeue', 'Re-queue')}
        </button>
      )}
    </AdminCard>
  );
}

function AdminPayoutsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('awaiting_approval');
  const [rejecting, setRejecting] = useState<Payout | null>(null);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'payouts', tab], queryFn: () => fetchPayouts(tab) });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/admin/payouts/${id}/approve`, {}),
    onSuccess: () => {
      showToast(t('admin.payouts.approved', 'Payout approved'));
      qc.invalidateQueries({ queryKey: ['admin', 'payouts'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.post(`/admin/payouts/${id}/reject`, { reason }),
    onSuccess: () => {
      showToast(t('admin.payouts.rejected', 'Payout rejected'));
      setRejecting(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin', 'payouts'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const retryMutation = useMutation({
    mutationFn: (dlqId: string) => apiClient.post(`/admin/payouts/dlq/${dlqId}/retry`, {}),
    onSuccess: () => {
      showToast(t('admin.payouts.requeued', 'Payout re-queued for processing'));
      qc.invalidateQueries({ queryKey: ['admin', 'payouts', 'dlq'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const tabs = [
    { key: 'awaiting_approval' as const, label: t('admin.payouts.tab.awaitingApproval', 'Awaiting Approval') },
    { key: 'approved' as const, label: t('admin.payouts.tab.approved', 'Approved') },
    { key: 'rejected' as const, label: t('admin.payouts.tab.rejected', 'Rejected') },
    { key: 'dlq' as const, label: t('admin.payouts.tab.dlq', 'Dead-Letter Queue') },
  ];

  const busyId = approveMutation.isPending
    ? approveMutation.variables
    : rejectMutation.isPending
      ? rejectMutation.variables?.id
      : retryMutation.isPending
        ? retryMutation.variables
        : null;

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.payouts', 'Creator Payouts')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

        {status === 'success' && tab === 'dlq' && (data?.dlqItems.length ?? 0) === 0 && (
          <AdminEmptyState icon="✅" title={t('admin.payouts.dlqEmpty', 'No items in the dead-letter queue')} />
        )}
        {status === 'success' && tab === 'dlq' &&
          data?.dlqItems.map((item) => (
            <DlqCard key={item.id} item={item} busy={busyId === item.id} onRetry={(id) => retryMutation.mutate(id)} />
          ))}

        {status === 'success' && tab !== 'dlq' && (data?.payouts.length ?? 0) === 0 && (
          <AdminEmptyState icon="💸" title={t('admin.payouts.empty', 'No {{tab}} payouts', { tab: tab.replace(/_/g, ' ') })} />
        )}
        {status === 'success' && tab !== 'dlq' &&
          data?.payouts.map((p) => (
            <PayoutCard
              key={p.id}
              payout={p}
              showActions={tab === 'awaiting_approval'}
              busy={busyId === p.id}
              onApprove={(id) => approveMutation.mutate(id)}
              onReject={(payout) => setRejecting(payout)}
            />
          ))}
      </div>

      {rejecting && (
        <AdminConfirmDialog
          title={t('admin.payouts.rejectTitle', 'Reject this payout?')}
          description={t('admin.payouts.rejectDescription', 'A reason is required (at least 10 characters) and will be shown to the creator.')}
          confirmLabel={t('admin.payouts.reject', 'Reject')}
          cancelLabel={t('common.cancel')}
          danger
          pending={rejectMutation.isPending}
          onCancel={() => { setRejecting(null); setReason(''); }}
          onConfirm={() => reason.trim().length >= 10 && rejectMutation.mutate({ id: rejecting.id, reason: reason.trim() })}
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('admin.payouts.reasonPlaceholder', 'Rejection reason (min 10 characters)…')}
            rows={3}
            className={`${adminInputClass} resize-none text-sm`}
          />
        </AdminConfirmDialog>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/payouts/')({
  component: AdminPayoutsPage,
});
