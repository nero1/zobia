/**
 * apps/android/src/routes/admin/quizzes.tsx
 *
 * Quizzes admin monitoring — mirrors apps/web/app/(admin)/admin/quizzes/page.tsx:
 * filter by status, search, status-change actions, delete-with-confirm.
 * Built with the AdminUI kit exactly like routes/admin/blogs.tsx.
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
  AdminTabs,
  AdminBadge,
  AdminConfirmDialog,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

type StatusFilter = 'all' | 'active' | 'closed' | 'disabled';

interface QuizRow {
  id: string;
  slug: string;
  title: string;
  status: 'active' | 'closed' | 'disabled';
  attempt_count: number;
  share_count: number;
  created_at: string;
  creator_id: string;
  creator_username: string;
}

const STATUS_COLOR: Record<string, 'green' | 'gold' | 'red' | 'neutral'> = {
  active: 'green',
  closed: 'gold',
  disabled: 'red',
};

async function fetchQuizzes(status: StatusFilter, q: string): Promise<{ items: QuizRow[]; hasMore: boolean; nextCursor: string | null }> {
  const params = new URLSearchParams({ status, limit: '50' });
  if (q) params.set('q', q);
  const { data } = await apiClient.get<{ items: QuizRow[]; hasMore: boolean; nextCursor: string | null }>(`/admin/quizzes?${params.toString()}`);
  return { items: data?.items ?? [], hasMore: data?.hasMore ?? false, nextCursor: data?.nextCursor ?? null };
}

function AdminQuizzesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuizRow | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, status: qStatus, refetch } = useQuery({
    queryKey: ['admin', 'quizzes', status, debouncedSearch],
    queryFn: () => fetchQuizzes(status, debouncedSearch),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: QuizRow['status'] }) => apiClient.patch(`/admin/quizzes/${id}/status`, { status: next }),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      qc.invalidateQueries({ queryKey: ['admin', 'quizzes', status, debouncedSearch] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
    onSettled: () => setBusyId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/quizzes/${id}`),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'quizzes', status, debouncedSearch] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
    onSettled: () => setBusyId(null),
  });

  function runStatus(id: string, next: QuizRow['status']) {
    setBusyId(id);
    statusMutation.mutate({ id, next });
  }

  const tabs = (['all', 'active', 'closed', 'disabled'] as StatusFilter[]).map((s) => ({
    key: s,
    label: s === 'all' ? t('admin.quizzes.tab.all', 'All') : s.charAt(0).toUpperCase() + s.slice(1),
  }));

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.quizzes', 'Quizzes')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.quizzes.searchPlaceholder', 'Search by title, slug, or creator username…')}
        className={`${adminInputClass} mb-3`}
      />

      <AdminTabs tabs={tabs} active={status} onChange={setStatus} />

      <div className="space-y-2.5">
        {qStatus === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {qStatus === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {qStatus === 'success' && (data?.items.length ?? 0) === 0 && <AdminEmptyState icon="🧠" title={t('admin.quizzes.empty', 'No quizzes')} />}
        {qStatus === 'success' &&
          data?.items.map((p) => {
            const busy = busyId === p.id;
            return (
              <AdminCard key={p.id}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-semibold text-neutral-900 truncate">{p.title}</p>
                  <AdminBadge label={p.status} color={STATUS_COLOR[p.status] ?? 'neutral'} />
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  @{p.creator_username} · {p.attempt_count} {t('admin.quizzes.attempts', 'attempts')} · {p.share_count} {t('admin.quizzes.shares', 'shares')} · {fmtDate(p.created_at)}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.status !== 'active' && (
                    <button disabled={busy} onClick={() => runStatus(p.id, 'active')} className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700 disabled:opacity-50">
                      {t('admin.quizzes.activate', 'Activate')}
                    </button>
                  )}
                  {p.status !== 'closed' && (
                    <button disabled={busy} onClick={() => runStatus(p.id, 'closed')} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                      {t('admin.quizzes.close', 'Close')}
                    </button>
                  )}
                  {p.status !== 'disabled' && (
                    <button disabled={busy} onClick={() => runStatus(p.id, 'disabled')} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                      {t('admin.quizzes.disable', 'Disable')}
                    </button>
                  )}
                  <button disabled={busy} onClick={() => setDeleting(p)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                    {t('common.delete', 'Delete')}
                  </button>
                </div>
              </AdminCard>
            );
          })}
      </div>

      {deleting && (
        <AdminConfirmDialog
          title={t('admin.quizzes.confirmDelete', 'Permanently delete "{{title}}"?', { title: deleting.title })}
          description={t('admin.blogs.confirmDeleteDesc', 'This cannot be undone.')}
          confirmLabel={t('common.delete', 'Delete')}
          cancelLabel={t('common.cancel')}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => { setBusyId(deleting.id); deleteMutation.mutate(deleting.id); }}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/quizzes')({
  component: AdminQuizzesPage,
});
