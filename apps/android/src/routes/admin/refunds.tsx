/**
 * apps/android/src/routes/admin/refunds.tsx
 *
 * Coin refunds — mirrors apps/web/app/(admin)/admin/refunds/page.tsx.
 * GET /admin/refunds?status=&limit=&offset= (returns {success,data:{refunds,total}},
 * auto-unwrapped by apiClient), POST /admin/refunds { userId, amountCoins, reason, referenceId }.
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
  AdminField,
  adminInputClass,
  fmtNumber,
  fmtDate,
  timeAgo,
} from '@/components/admin/AdminUI';

type TabKey = 'pending' | 'processed';

interface RefundRecord {
  id: string;
  user_id: string;
  username: string | null;
  amount_coins: number;
  reason: string;
  reference_id: string;
  status: string;
  created_at: string;
}

async function fetchRefunds(status: TabKey): Promise<{ refunds: RefundRecord[]; total: number }> {
  const { data } = await apiClient.get<{ refunds: RefundRecord[]; total: number }>(`/admin/refunds?status=${status}&limit=50&offset=0`);
  return { refunds: data?.refunds ?? [], total: data?.total ?? 0 };
}

function RefundModal({ record, onClose, onSubmit, pending }: {
  record: RefundRecord;
  onClose: () => void;
  onSubmit: (amountCoins: number, reason: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(String(record.amount_coins));
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = () => {
    const parsed = parseInt(amount, 10);
    if (isNaN(parsed) || parsed < 1) {
      setFormError(t('admin.refunds.amountError', 'Amount must be a positive whole number.'));
      return;
    }
    if (!reason.trim() || reason.trim().length < 5) {
      setFormError(t('admin.refunds.reasonError', 'Please enter a reason (at least 5 characters).'));
      return;
    }
    setFormError(null);
    onSubmit(parsed, reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-bold text-neutral-900">{t('admin.refunds.issueRefund', 'Issue Refund')}</h2>
        <p className="mb-4 text-sm text-neutral-500">
          {t('admin.refunds.user', 'User')}: <span className="font-semibold text-neutral-700">@{record.username ?? record.user_id}</span>
        </p>

        <div className="space-y-3">
          <AdminField label={t('admin.refunds.amountCoins', 'Amount (coins)')}>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.refunds.reason', 'Reason')}>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('admin.refunds.reasonPlaceholder', 'Explain why this refund is being issued…')}
              rows={3}
              className={`${adminInputClass} resize-none`}
            />
          </AdminField>

          {formError && <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{formError}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending}
              className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? '…' : t('admin.refunds.issueRefund', 'Issue Refund')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminRefundsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('pending');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<RefundRecord | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'refunds', tab], queryFn: () => fetchRefunds(tab) });

  const issueRefund = useMutation({
    mutationFn: ({ userId, amountCoins, reason, referenceId }: { userId: string; amountCoins: number; reason: string; referenceId: string }) =>
      apiClient.post('/admin/refunds', { userId, amountCoins, reason, referenceId }),
    onSuccess: () => {
      showToast(t('admin.refunds.issued', 'Refund issued successfully'));
      setModal(null);
      qc.invalidateQueries({ queryKey: ['admin', 'refunds'] });
    },
    onError: () => showToast(t('admin.refunds.failed', 'Refund failed'), 'error'),
  });

  const filtered = search
    ? (data?.refunds ?? []).filter(
        (r) => (r.username ?? '').toLowerCase().includes(search.toLowerCase()) || r.user_id.toLowerCase().includes(search.toLowerCase())
      )
    : (data?.refunds ?? []);

  const tabs = [
    { key: 'pending' as const, label: t('admin.refunds.tab.pending', 'Pending') },
    { key: 'processed' as const, label: t('admin.refunds.tab.processed', 'Processed') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.refunds', 'Coin Refunds')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.refunds.searchPlaceholder', 'Search by username…')}
        className={`${adminInputClass} mb-4`}
      />

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && filtered.length === 0 && (
          <AdminEmptyState
            icon="💰"
            title={search ? t('admin.refunds.noResults', 'No results match your search') : t('admin.refunds.empty', 'No {{tab}} refunds', { tab })}
          />
        )}
        {status === 'success' &&
          filtered.map((r) => (
            <AdminCard key={r.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-neutral-900">@{r.username ?? '—'}</p>
                  <p className="truncate text-[10px] text-neutral-400">{r.user_id}</p>
                </div>
                <span className="shrink-0 font-semibold text-amber-600">{fmtNumber(r.amount_coins)} {t('admin.refunds.coins', 'coins')}</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs text-neutral-600">{r.reason}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-neutral-400">{timeAgo(r.created_at)} · {fmtDate(r.created_at)}</span>
                {r.status === 'pending' ? (
                  <button
                    type="button"
                    onClick={() => setModal(r)}
                    className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700"
                  >
                    {t('admin.refunds.issueRefund', 'Issue Refund')}
                  </button>
                ) : (
                  <span className="rounded-full bg-success-100 px-2.5 py-0.5 text-xs font-semibold text-success-700">
                    {t('admin.refunds.processed', 'Processed')}
                  </span>
                )}
              </div>
            </AdminCard>
          ))}
      </div>

      {modal && (
        <RefundModal
          record={modal}
          onClose={() => setModal(null)}
          pending={issueRefund.isPending}
          onSubmit={(amountCoins, reason) =>
            issueRefund.mutate({ userId: modal.user_id, amountCoins, reason, referenceId: modal.reference_id })
          }
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/refunds')({
  component: AdminRefundsPage,
});
