/**
 * apps/android/src/routes/admin/blogs.tsx
 *
 * Blogs admin monitoring — mirrors apps/web/app/(admin)/admin/blogs/page.tsx:
 * filter by status, suspend/ban/deactivate/pause/restore/delete, and
 * transfer ownership to another user by username.
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
  AdminField,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

type StatusFilter = 'all' | 'active' | 'paused' | 'suspended' | 'banned' | 'deactivated';
type Action = 'suspend' | 'ban' | 'deactivate' | 'pause' | 'restore' | 'delete';

interface BlogRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  status_reason: string | null;
  subscriber_count: number;
  post_count: number;
  created_at: string;
  owner_id: string;
  owner_username: string;
}

const STATUS_COLOR: Record<string, 'green' | 'gold' | 'red' | 'neutral'> = {
  active: 'green',
  paused: 'gold',
  suspended: 'red',
  banned: 'red',
  deactivated: 'neutral',
};

async function fetchBlogs(status: StatusFilter, q: string): Promise<BlogRow[]> {
  const params = new URLSearchParams({ status, limit: '50' });
  if (q) params.set('q', q);
  const { data } = await apiClient.get<{ items: BlogRow[] }>(`/admin/blogs?${params.toString()}`);
  return data?.items ?? [];
}

async function findUserIdByUsername(username: string): Promise<string | null> {
  const { data } = await apiClient.get<{ users: { id: string; username: string }[] }>(`/admin/users?q=${encodeURIComponent(username)}&limit=5`);
  const match = (data?.users ?? []).find((u) => u.username.toLowerCase() === username.toLowerCase());
  return match?.id ?? null;
}

function TransferModal({ blog, onClose, onSave, saving }: { blog: BlogRow; onClose: () => void; onSave: (username: string) => void; saving: boolean }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <p className="text-base font-bold text-neutral-900">{t('admin.blogs.transferTitle', 'Transfer "{{title}}"', { title: blog.title })}</p>
        <p className="mt-1 text-sm text-neutral-500">{t('admin.blogs.transferDesc', 'Enter the username of the new owner.')}</p>
        <AdminField label={t('admin.blogs.newOwnerUsername', 'New Owner Username')}>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" className={`${adminInputClass} mt-3`} />
        </AdminField>
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !username.trim()}
            onClick={() => onSave(username.trim())}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '…' : t('admin.blogs.transfer', 'Transfer')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReasonActionModal({
  blog,
  action,
  onClose,
  onSave,
  saving,
}: {
  blog: BlogRow;
  action: 'suspend' | 'ban';
  onClose: () => void;
  onSave: (reason: string) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  return (
    <AdminConfirmDialog
      title={action === 'ban' ? t('admin.blogs.confirmBan', 'Ban "{{title}}"?', { title: blog.title }) : t('admin.blogs.confirmSuspend', 'Suspend "{{title}}"?', { title: blog.title })}
      confirmLabel={action === 'ban' ? t('admin.blogs.ban', 'Ban') : t('admin.blogs.suspend', 'Suspend')}
      cancelLabel={t('common.cancel')}
      danger
      pending={saving}
      onCancel={onClose}
      onConfirm={() => onSave(reason.trim())}
    >
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('admin.blogs.reasonPlaceholder', 'Reason (optional)…')}
        rows={2}
        className={`${adminInputClass} resize-none text-sm`}
      />
    </AdminConfirmDialog>
  );
}

function AdminBlogsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<{ blog: BlogRow; action: 'suspend' | 'ban' } | null>(null);
  const [deleting, setDeleting] = useState<BlogRow | null>(null);
  const [transferring, setTransferring] = useState<BlogRow | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, status: qStatus, refetch } = useQuery({ queryKey: ['admin', 'blogs', status, debouncedSearch], queryFn: () => fetchBlogs(status, debouncedSearch) });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: Action; reason?: string }) =>
      apiClient.patch(`/admin/blogs/${id}/status`, { action, reason }),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      setReasonAction(null);
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'blogs', status, debouncedSearch] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
    onSettled: () => setBusyId(null),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ id, username }: { id: string; username: string }) => {
      const newOwnerId = await findUserIdByUsername(username);
      if (!newOwnerId) throw new Error(`No user found with username "${username}"`);
      return apiClient.post(`/admin/blogs/${id}/transfer`, { newOwnerId });
    },
    onSuccess: (_res, vars) => {
      showToast(t('admin.blogs.transferred', 'Transferred to @{{username}}', { username: vars.username }));
      setTransferring(null);
      qc.invalidateQueries({ queryKey: ['admin', 'blogs', status, debouncedSearch] });
    },
    onError: (err: unknown) => showToast(err instanceof Error ? err.message : t('admin.blogs.transferFailed', 'Transfer failed'), 'error'),
    onSettled: () => setBusyId(null),
  });

  function runAction(id: string, action: Action, reason?: string) {
    setBusyId(id);
    actionMutation.mutate({ id, action, reason });
  }

  const tabs = (['all', 'active', 'paused', 'suspended', 'banned', 'deactivated'] as StatusFilter[]).map((s) => ({
    key: s,
    label: s === 'all' ? t('admin.blogs.tab.all', 'All') : s.charAt(0).toUpperCase() + s.slice(1),
  }));

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.blogs', 'Blogs')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.blogs.searchPlaceholder', 'Search by title, slug, owner username, or email…')}
        className={`${adminInputClass} mb-3`}
      />

      <AdminTabs tabs={tabs} active={status} onChange={setStatus} />

      <div className="space-y-2.5">
        {qStatus === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {qStatus === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {qStatus === 'success' && (data?.length ?? 0) === 0 && <AdminEmptyState icon="📝" title={t('admin.blogs.empty', 'No blogs')} />}
        {qStatus === 'success' &&
          data?.map((b) => {
            const busy = busyId === b.id;
            return (
              <AdminCard key={b.id}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-semibold text-neutral-900 truncate">{b.title}</p>
                  <AdminBadge label={b.status} color={STATUS_COLOR[b.status] ?? 'neutral'} />
                </div>
                {b.status_reason && <p className="mt-0.5 text-[11px] text-neutral-500 line-clamp-1">{b.status_reason}</p>}
                <p className="mt-1 text-xs text-neutral-500">
                  @{b.owner_username} · {b.post_count} {t('admin.blogs.posts', 'posts')} · {b.subscriber_count} {t('admin.blogs.subscribers', 'subscribers')} · {fmtDate(b.created_at)}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {b.status !== 'active' && (
                    <button disabled={busy} onClick={() => runAction(b.id, 'restore')} className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700 disabled:opacity-50">
                      {t('admin.blogs.restore', 'Restore')}
                    </button>
                  )}
                  {b.status === 'active' && (
                    <>
                      <button disabled={busy} onClick={() => runAction(b.id, 'pause')} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                        {t('admin.blogs.pause', 'Pause')}
                      </button>
                      <button disabled={busy} onClick={() => setReasonAction({ blog: b, action: 'suspend' })} className="rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700 disabled:opacity-50">
                        {t('admin.blogs.suspend', 'Suspend')}
                      </button>
                      <button disabled={busy} onClick={() => setReasonAction({ blog: b, action: 'ban' })} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                        {t('admin.blogs.ban', 'Ban')}
                      </button>
                      <button disabled={busy} onClick={() => runAction(b.id, 'deactivate')} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                        {t('admin.blogs.deactivate', 'Deactivate')}
                      </button>
                    </>
                  )}
                  <button disabled={busy} onClick={() => setTransferring(b)} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 disabled:opacity-50">
                    {t('admin.blogs.transfer', 'Transfer')}
                  </button>
                  <button disabled={busy} onClick={() => setDeleting(b)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                    {t('common.delete', 'Delete')}
                  </button>
                </div>
              </AdminCard>
            );
          })}
      </div>

      {reasonAction && (
        <ReasonActionModal
          blog={reasonAction.blog}
          action={reasonAction.action}
          onClose={() => setReasonAction(null)}
          saving={actionMutation.isPending}
          onSave={(reason) => runAction(reasonAction.blog.id, reasonAction.action, reason || undefined)}
        />
      )}

      {deleting && (
        <AdminConfirmDialog
          title={t('admin.blogs.confirmDelete', 'Permanently delete "{{title}}"?', { title: deleting.title })}
          description={t('admin.blogs.confirmDeleteDesc', 'This cannot be undone.')}
          confirmLabel={t('common.delete', 'Delete')}
          cancelLabel={t('common.cancel')}
          danger
          pending={actionMutation.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => runAction(deleting.id, 'delete')}
        />
      )}

      {transferring && (
        <TransferModal
          blog={transferring}
          onClose={() => setTransferring(null)}
          saving={transferMutation.isPending}
          onSave={(username) => { setBusyId(transferring.id); transferMutation.mutate({ id: transferring.id, username }); }}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/blogs')({
  component: AdminBlogsPage,
});
