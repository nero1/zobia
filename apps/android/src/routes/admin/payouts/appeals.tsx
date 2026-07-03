/**
 * apps/android/src/routes/admin/payouts/appeals.tsx
 *
 * Payout appeals — mirrors apps/web/app/(admin)/admin/payouts/appeals/page.tsx:
 * GET /api/admin/payouts?appealPending=true, PATCH /api/admin/payouts/:id/appeal { action: 'approve'|'dismiss' }.
 *
 * BUG FIX: the web page read a `total` field from GET /api/admin/payouts
 * that the route never returns (keyset-paginated, no total — see the fix in
 * apps/web/app/(admin)/admin/payouts/page.tsx and appeals/page.tsx in this
 * same change). This page derives the count from the loaded list instead.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminCard, AdminCardSkeleton, AdminEmptyState, AdminErrorState, AdminToast, fmtCurrency, timeAgo } from '@/components/admin/AdminUI';

interface Appeal {
  id: string;
  creator: { id: string; username: string; email: string | null };
  grossKobo: number;
  netKobo: number;
  method: string;
  region: string;
  rejectionReason: string | null;
  appealReason: string | null;
  createdAt: string;
}

function koboToNgn(kobo: number): number {
  return kobo / 100;
}

async function fetchAppeals(): Promise<Appeal[]> {
  const { data } = await apiClient.get<{ payouts: Appeal[] }>('/admin/payouts?appealPending=true&limit=50');
  return data?.payouts ?? [];
}

function AppealCard({ appeal, onApprove, onDismiss, busy }: {
  appeal: Appeal;
  onApprove: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AdminCard>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-neutral-900">@{appeal.creator.username}</p>
          {appeal.creator.email && <p className="truncate text-xs text-neutral-400">{appeal.creator.email}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold text-neutral-900">{fmtCurrency(koboToNgn(appeal.netKobo))}</p>
          <p className="text-[10px] text-neutral-400">{t('admin.payouts.gross', 'gross')} {fmtCurrency(koboToNgn(appeal.grossKobo))}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-neutral-500">
        <span className="rounded-full bg-neutral-100 px-2 py-0.5">{appeal.method.replace(/_/g, ' ')}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5">{appeal.region}</span>
        <span className="self-center">{timeAgo(appeal.createdAt)}</span>
      </div>

      {appeal.rejectionReason && (
        <div className="mt-2.5 rounded-lg bg-danger-50 p-2.5 text-xs text-danger-700">
          <p className="mb-0.5 font-semibold">{t('admin.payouts.appeals.originalReason', 'Original rejection reason:')}</p>
          <p>{appeal.rejectionReason}</p>
        </div>
      )}
      {appeal.appealReason && (
        <div className="mt-2 rounded-lg bg-blue-50 p-2.5 text-xs text-blue-700">
          <p className="mb-0.5 font-semibold">{t('admin.payouts.appeals.creatorReason', "Creator's appeal reason:")}</p>
          <p>{appeal.appealReason}</p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="flex-1 rounded-lg border border-neutral-300 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50"
        >
          {t('admin.payouts.appeals.dismiss', 'Dismiss')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="flex-1 rounded-lg bg-success-600 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {t('admin.payouts.appeals.approve', 'Approve Appeal')}
        </button>
      </div>
    </AdminCard>
  );
}

function AdminPayoutAppealsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'payouts', 'appeals'], queryFn: fetchAppeals });

  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'dismiss' }) =>
      apiClient.patch(`/admin/payouts/${id}/appeal`, { action }),
    onSuccess: (_data, vars) => {
      showToast(vars.action === 'approve' ? t('admin.payouts.appeals.approved', 'Appeal approved') : t('admin.payouts.appeals.dismissed', 'Appeal dismissed'));
      qc.invalidateQueries({ queryKey: ['admin', 'payouts'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.payoutAppeals', 'Payout Appeals')}</h1>
      <p className="mb-4 mt-1 text-sm text-neutral-500">{t('admin.payouts.appeals.subtitle', 'Review creator appeals for rejected payouts.')}</p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      {status === 'success' && (
        <p className="mb-3 text-sm text-neutral-500">
          {t('admin.payouts.appeals.count', '{{count}} pending appeal', { count: data?.length ?? 0 })}
          {(data?.length ?? 0) !== 1 ? 's' : ''}
        </p>
      )}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (data?.length ?? 0) === 0 && (
          <AdminEmptyState icon="⚖️" title={t('admin.payouts.appeals.empty', 'No pending appeals')} />
        )}
        {status === 'success' &&
          data?.map((appeal) => (
            <AppealCard
              key={appeal.id}
              appeal={appeal}
              busy={resolve.isPending && resolve.variables?.id === appeal.id}
              onApprove={() => resolve.mutate({ id: appeal.id, action: 'approve' })}
              onDismiss={() => resolve.mutate({ id: appeal.id, action: 'dismiss' })}
            />
          ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/payouts/appeals')({
  component: AdminPayoutAppealsPage,
});
