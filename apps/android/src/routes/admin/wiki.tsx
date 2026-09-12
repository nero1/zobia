/**
 * apps/android/src/routes/admin/wiki.tsx
 *
 * Wiki admin monitoring — mirrors routes/admin/blogs.tsx exactly (same
 * action set: suspend/ban/deactivate/pause/restore/delete, transfer
 * ownership), adapted to the wiki row shape. The backend exposes the same
 * moderator/admin action surface for wikis as for blogs (GET/PATCH
 * /api/admin/wiki, POST /api/admin/wiki/:id/transfer).
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

interface WikiRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  status_reason: string | null;
  contribute_policy: string;
  page_count: number;
  contributor_count: number;
  view_count: number;
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

async function fetchWikis(status: StatusFilter, q: string): Promise<WikiRow[]> {
  const params = new URLSearchParams({ status, limit: '50' });
  if (q) params.set('q', q);
  const { data } = await apiClient.get<{ items: WikiRow[] }>(`/admin/wiki?${params.toString()}`);
  return data?.items ?? [];
}

async function findUserIdByUsername(username: string): Promise<string | null> {
  const { data } = await apiClient.get<{ users: { id: string; username: string }[] }>(`/admin/users?q=${encodeURIComponent(username)}&limit=5`);
  const match = (data?.users ?? []).find((u) => u.username.toLowerCase() === username.toLowerCase());
  return match?.id ?? null;
}

function TransferModal({ wiki, onClose, onSave, saving }: { wiki: WikiRow; onClose: () => void; onSave: (username: string) => void; saving: boolean }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <p className="text-base font-bold text-neutral-900">{t('admin.wiki.transferTitle', 'Transfer "{{name}}"', { name: wiki.name })}</p>
        <p className="mt-1 text-sm text-neutral-500">{t('admin.wiki.transferDesc', 'Enter the username of the new owner.')}</p>
        <AdminField label={t('admin.wiki.newOwnerUsername', 'New Owner Username')}>
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
            {saving ? '…' : t('admin.wiki.transfer', 'Transfer')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReasonActionModal({
  wiki,
  action,
  onClose,
  onSave,
  saving,
}: {
  wiki: WikiRow;
  action: 'suspend' | 'ban';
  onClose: () => void;
  onSave: (reason: string) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');

  return (
    <AdminConfirmDialog
      title={action === 'ban' ? t('admin.wiki.confirmBan', 'Ban "{{name}}"?', { name: wiki.name }) : t('admin.wiki.confirmSuspend', 'Suspend "{{name}}"?', { name: wiki.name })}
      confirmLabel={action === 'ban' ? t('admin.wiki.ban', 'Ban') : t('admin.wiki.suspend', 'Suspend')}
      cancelLabel={t('common.cancel')}
      danger
      pending={saving}
      onCancel={onClose}
      onConfirm={() => onSave(reason.trim())}
    >
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('admin.wiki.reasonPlaceholder', 'Reason (optional)…')}
        rows={2}
        className={`${adminInputClass} resize-none text-sm`}
      />
    </AdminConfirmDialog>
  );
}

function AdminWikiPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<{ wiki: WikiRow; action: 'suspend' | 'ban' } | null>(null);
  const [deleting, setDeleting] = useState<WikiRow | null>(null);
  const [transferring, setTransferring] = useState<WikiRow | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, status: qStatus, refetch } = useQuery({ queryKey: ['admin', 'wiki', status, debouncedSearch], queryFn: () => fetchWikis(status, debouncedSearch) });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: Action; reason?: string }) =>
      apiClient.patch(`/admin/wiki/${id}/status`, { action, reason }),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      setReasonAction(null);
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'wiki', status, debouncedSearch] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
    onSettled: () => setBusyId(null),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ id, username }: { id: string; username: string }) => {
      const newOwnerId = await findUserIdByUsername(username);
      if (!newOwnerId) throw new Error(`No user found with username "${username}"`);
      return apiClient.post(`/admin/wiki/${id}/transfer`, { newOwnerId });
    },
    onSuccess: (_res, vars) => {
      showToast(t('admin.wiki.transferred', 'Transferred to @{{username}}', { username: vars.username }));
      setTransferring(null);
      qc.invalidateQueries({ queryKey: ['admin', 'wiki', status, debouncedSearch] });
    },
    onError: (err: unknown) => showToast(err instanceof Error ? err.message : t('admin.wiki.transferFailed', 'Transfer failed'), 'error'),
    onSettled: () => setBusyId(null),
  });

  function runAction(id: string, action: Action, reason?: string) {
    setBusyId(id);
    actionMutation.mutate({ id, action, reason });
  }

  const tabs = (['all', 'active', 'paused', 'suspended', 'banned', 'deactivated'] as StatusFilter[]).map((s) => ({
    key: s,
    label: s === 'all' ? t('admin.wiki.tab.all', 'All') : s.charAt(0).toUpperCase() + s.slice(1),
  }));

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.wiki', 'Wiki')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.wiki.searchPlaceholder', 'Search by name, slug, owner username, or email…')}
        className={`${adminInputClass} mb-3`}
      />

      <AdminTabs tabs={tabs} active={status} onChange={setStatus} />

      <div className="space-y-2.5">
        {qStatus === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {qStatus === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {qStatus === 'success' && (data?.length ?? 0) === 0 && <AdminEmptyState icon="📖" title={t('admin.wiki.empty', 'No wikis')} />}
        {qStatus === 'success' &&
          data?.map((w) => {
            const busy = busyId === w.id;
            return (
              <AdminCard key={w.id}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-semibold text-neutral-900 truncate">{w.name}</p>
                  <AdminBadge label={w.status} color={STATUS_COLOR[w.status] ?? 'neutral'} />
                </div>
                {w.status_reason && <p className="mt-0.5 text-[11px] text-neutral-500 line-clamp-1">{w.status_reason}</p>}
                <p className="mt-1 text-xs text-neutral-500">
                  @{w.owner_username} · {w.page_count} {t('admin.wiki.pages', 'pages')} · {w.contributor_count} {t('admin.wiki.contributors', 'contributors')} · {fmtDate(w.created_at)}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {w.status !== 'active' && (
                    <button disabled={busy} onClick={() => runAction(w.id, 'restore')} className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700 disabled:opacity-50">
                      {t('admin.wiki.restore', 'Restore')}
                    </button>
                  )}
                  {w.status === 'active' && (
                    <>
                      <button disabled={busy} onClick={() => runAction(w.id, 'pause')} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                        {t('admin.wiki.pause', 'Pause')}
                      </button>
                      <button disabled={busy} onClick={() => setReasonAction({ wiki: w, action: 'suspend' })} className="rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700 disabled:opacity-50">
                        {t('admin.wiki.suspend', 'Suspend')}
                      </button>
                      <button disabled={busy} onClick={() => setReasonAction({ wiki: w, action: 'ban' })} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                        {t('admin.wiki.ban', 'Ban')}
                      </button>
                      <button disabled={busy} onClick={() => runAction(w.id, 'deactivate')} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                        {t('admin.wiki.deactivate', 'Deactivate')}
                      </button>
                    </>
                  )}
                  <button disabled={busy} onClick={() => setTransferring(w)} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 disabled:opacity-50">
                    {t('admin.wiki.transfer', 'Transfer')}
                  </button>
                  <button disabled={busy} onClick={() => setDeleting(w)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                    {t('common.delete', 'Delete')}
                  </button>
                </div>
              </AdminCard>
            );
          })}
      </div>

      {reasonAction && (
        <ReasonActionModal
          wiki={reasonAction.wiki}
          action={reasonAction.action}
          onClose={() => setReasonAction(null)}
          saving={actionMutation.isPending}
          onSave={(reason) => runAction(reasonAction.wiki.id, reasonAction.action, reason || undefined)}
        />
      )}

      {deleting && (
        <AdminConfirmDialog
          title={t('admin.wiki.confirmDelete', 'Permanently delete "{{name}}"?', { name: deleting.name })}
          description={t('admin.wiki.confirmDeleteDesc', 'This cannot be undone.')}
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
          wiki={transferring}
          onClose={() => setTransferring(null)}
          saving={transferMutation.isPending}
          onSave={(username) => { setBusyId(transferring.id); transferMutation.mutate({ id: transferring.id, username }); }}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/wiki')({
  component: AdminWikiPage,
});
