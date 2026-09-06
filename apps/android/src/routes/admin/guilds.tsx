/**
 * apps/android/src/routes/admin/guilds.tsx
 *
 * Guild Management admin — mirrors apps/web/app/(admin)/gate44/guilds/page.tsx.
 * Search + status filter, cursor pagination, and the full action set matching
 * the backend's PATCH /api/admin/guilds/:guildId discriminated-union `action`
 * enum (set_active/set_inactive/suspend/unsuspend/ban/unban/update_details/
 * add_admin_notes/transfer_captain/remove_member) plus DELETE, plus a member
 * roster panel for captain transfer / member removal.
 */

import { useState, useEffect, useCallback } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { apiClient } from '@/lib/api/client';
import { env } from '@/lib/env';
import {
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  AdminConfirmDialog,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

type StatusFilter = 'all' | 'active' | 'inactive' | 'suspended' | 'banned';
const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'inactive', 'suspended', 'banned'];
const RECRUITMENT_TYPES = ['open', 'approval', 'invite_only'];

type SimpleAction = 'set_active' | 'set_inactive' | 'unsuspend' | 'unban';

interface AdminGuild {
  id: string;
  name: string;
  crest_emoji: string;
  description: string | null;
  city: string | null;
  country: string;
  captain_id: string;
  captain_username: string;
  tier: string;
  member_count: number;
  recruitment_type: string;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  is_banned: boolean;
  admin_notes: string | null;
  created_at: string;
}

interface GuildMember {
  id: string;
  user_id: string;
  role: string;
  contribution_score: number;
  joined_at: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
}

async function fetchGuilds(search: string, statusFilter: StatusFilter, cursor: string | undefined) {
  const params = new URLSearchParams({ limit: '20' });
  if (search) params.set('search', search);
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<{ guilds: AdminGuild[]; pagination: { hasNextPage: boolean; nextCursor: string | null } }>(`/admin/guilds?${params}`);
  return { guilds: data?.guilds ?? [], hasNextPage: data?.pagination?.hasNextPage ?? false, nextCursor: data?.pagination?.nextCursor ?? null };
}

function GuildStatusBadge({ guild }: { guild: AdminGuild }) {
  const { t } = useTranslation();
  if (guild.is_banned) return <AdminBadge label={t('admin.guilds.status.banned', 'Banned')} color="red" />;
  if (guild.is_suspended) return <AdminBadge label={t('admin.guilds.status.suspended', 'Suspended')} color="gold" />;
  if (guild.is_active) return <AdminBadge label={t('admin.guilds.status.active', 'Active')} color="green" />;
  return <AdminBadge label={t('admin.guilds.status.inactive', 'Inactive')} color="neutral" />;
}

interface EditForm {
  name: string;
  crestEmoji: string;
  description: string;
  city: string;
  country: string;
  recruitmentType: string;
}

function EditOverlay({ guild, onClose, onSave, pending }: { guild: AdminGuild; onClose: () => void; onSave: (payload: Record<string, unknown>) => void; pending: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<EditForm>({
    name: guild.name,
    crestEmoji: guild.crest_emoji,
    description: guild.description ?? '',
    city: guild.city ?? '',
    country: guild.country,
    recruitmentType: guild.recruitment_type,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl max-h-[85vh] overflow-y-auto">
        <h3 className="mb-4 text-base font-bold text-neutral-900">{t('admin.guilds.editDetails', 'Edit Details')}</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.name', 'Guild Name')}</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={adminInputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.crest', 'Crest Emoji')}</label>
            <input value={form.crestEmoji} onChange={(e) => setForm((f) => ({ ...f, crestEmoji: e.target.value }))} maxLength={4} className={`${adminInputClass} w-20 text-center text-lg`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.description', 'Description')}</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={`${adminInputClass} resize-none`} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.city', 'City')}</label>
              <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className={adminInputClass} />
            </div>
            <div className="w-20">
              <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.country', 'Country')}</label>
              <input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))} maxLength={2} className={`${adminInputClass} uppercase`} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.recruitment', 'Recruitment')}</label>
            <select value={form.recruitmentType} onChange={(e) => setForm((f) => ({ ...f, recruitmentType: e.target.value }))} className={adminInputClass}>
              {RECRUITMENT_TYPES.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const payload: Record<string, unknown> = { action: 'update_details' };
              if (form.name.trim()) payload.name = form.name.trim();
              if (form.crestEmoji.trim()) payload.crestEmoji = form.crestEmoji.trim();
              if (form.description !== (guild.description ?? '')) payload.description = form.description.trim();
              if (form.city !== (guild.city ?? '')) payload.city = form.city.trim();
              if (form.country.trim()) payload.country = form.country.trim().toUpperCase();
              if (form.recruitmentType) payload.recruitmentType = form.recruitmentType;
              onSave(payload);
            }}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? '…' : t('common.confirm', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function MembersOverlay({
  guild,
  onClose,
  onTransfer,
  onRemove,
  pending,
}: {
  guild: AdminGuild;
  onClose: () => void;
  onTransfer: (userId: string) => void;
  onRemove: (userId: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const { data, status } = useQuery({
    queryKey: ['admin', 'guilds', guild.id, 'detail'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ members: GuildMember[] }>(`/admin/guilds/${guild.id}`);
      return data?.members ?? [];
    },
  });
  const [transferTarget, setTransferTarget] = useState<GuildMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<GuildMember | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-bold text-neutral-900">{guild.crest_emoji} {guild.name} — {t('guild.membersSection', 'Members')}</h3>
        {status === 'pending' ? (
          <p className="text-sm text-neutral-500">…</p>
        ) : (
          <div className="space-y-2">
            {(data ?? []).map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 p-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-neutral-900">{m.avatar_emoji ?? '👤'} {m.display_name ?? m.username} <span className="text-xs text-neutral-500">@{m.username}</span></p>
                  <p className="text-xs capitalize text-neutral-500">{m.role} · {m.contribution_score}</p>
                </div>
                {m.role !== 'captain' && (
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button" disabled={pending} onClick={() => setTransferTarget(m)} className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 disabled:opacity-50">
                      {t('admin.guilds.makeCaptain', 'Make Captain')}
                    </button>
                    <button type="button" disabled={pending} onClick={() => setRemoveTarget(m)} className="rounded-lg bg-danger-100 px-2 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                      {t('admin.guilds.remove', 'Remove')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700">
          {t('common.close', 'Close')}
        </button>

        {transferTarget && (
          <AdminConfirmDialog
            title={t('admin.guilds.transferConfirmTitle', 'Make @{{username}} the captain?', { username: transferTarget.username })}
            description={t('admin.guilds.transferConfirmBody', 'The current captain will be demoted to Veteran.')}
            confirmLabel={t('admin.guilds.transfer', 'Transfer')}
            cancelLabel={t('common.cancel', 'Cancel')}
            pending={pending}
            onCancel={() => setTransferTarget(null)}
            onConfirm={() => { onTransfer(transferTarget.user_id); setTransferTarget(null); }}
          />
        )}
        {removeTarget && (
          <AdminConfirmDialog
            title={t('admin.guilds.removeConfirmTitle', 'Remove @{{username}} from the guild?', { username: removeTarget.username })}
            confirmLabel={t('admin.guilds.remove', 'Remove')}
            cancelLabel={t('common.cancel', 'Cancel')}
            danger
            pending={pending}
            onCancel={() => setRemoveTarget(null)}
            onConfirm={() => { onRemove(removeTarget.user_id); setRemoveTarget(null); }}
          />
        )}
      </div>
    </div>
  );
}

function AdminGuildsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [editTarget, setEditTarget] = useState<AdminGuild | null>(null);
  const [membersTarget, setMembersTarget] = useState<AdminGuild | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminGuild | null>(null);
  const [reason, setReason] = useState('');
  const [banTarget, setBanTarget] = useState<AdminGuild | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminGuild | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setCursorHistory([undefined]);
    setPageIndex(0);
  }, [debouncedSearch, statusFilter]);

  const cursor = cursorHistory[pageIndex];
  const { data, status, refetch } = useQuery({
    queryKey: ['admin', 'guilds', debouncedSearch, statusFilter, cursor],
    queryFn: () => fetchGuilds(debouncedSearch, statusFilter, cursor),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'guilds'] });
  };

  const patchAction = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) => apiClient.patch(`/admin/guilds/${id}`, payload),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      invalidate();
      setEditTarget(null);
      setSuspendTarget(null);
      setReason('');
      setBanTarget(null);
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const deleteAction = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/guilds/${id}`),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      invalidate();
      setDeleteTarget(null);
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const doSimple = (guild: AdminGuild, action: SimpleAction) => patchAction.mutate({ id: guild.id, payload: { action } });

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.guilds.title', 'Guild Management')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.guilds.search', 'Search guilds…')}
        className={`${adminInputClass} mb-3`}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusFilter === s ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}
          >
            {t(`admin.guilds.status.${s}`, s)}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && data.guilds.length === 0 && <AdminEmptyState icon="🏰" title={t('admin.guilds.empty', 'No guilds found')} />}

        {status === 'success' &&
          data.guilds.map((guild) => (
            <AdminCard key={guild.id}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span>{guild.crest_emoji}</span>
                <p className="font-semibold text-neutral-900 truncate">{guild.name}</p>
                <GuildStatusBadge guild={guild} />
                <AdminBadge label={guild.tier} color="neutral" />
              </div>
              <p className="mb-1 text-xs text-neutral-500">
                @{guild.captain_username} · {guild.member_count} · {guild.city ? `${guild.city}, ` : ''}{guild.country} · {fmtDate(guild.created_at)}
              </p>
              {guild.suspension_reason && <p className="mb-1 text-xs text-amber-600">{t('admin.rooms.suspendReason', 'Suspension reason')}: {guild.suspension_reason}</p>}

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => Browser.open({ url: `${env.VITE_WEB_BASE_URL}/guilds/${guild.id}` })}
                  className="rounded-lg bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700"
                >
                  {t('admin.rooms.viewRoom', 'View ↗')}
                </button>
                <button type="button" disabled={patchAction.isPending} onClick={() => setMembersTarget(guild)} className="rounded-lg bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700 disabled:opacity-50">
                  {t('guild.membersSection', 'Members')}
                </button>
                <button type="button" disabled={patchAction.isPending} onClick={() => setEditTarget(guild)} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 disabled:opacity-50">
                  {t('admin.rooms.editDetails', 'Edit Details')}
                </button>
                {guild.is_active ? (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(guild, 'set_inactive')} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                    {t('admin.guilds.disable', 'Disable')}
                  </button>
                ) : (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(guild, 'set_active')} className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700 disabled:opacity-50">
                    {t('admin.guilds.enable', 'Enable')}
                  </button>
                )}
                {guild.is_suspended ? (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(guild, 'unsuspend')} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 disabled:opacity-50">
                    {t('admin.rooms.unsuspend', 'Unsuspend')}
                  </button>
                ) : !guild.is_banned && (
                  <button type="button" disabled={patchAction.isPending} onClick={() => { setSuspendTarget(guild); setReason(''); }} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 disabled:opacity-50">
                    {t('admin.rooms.suspend', 'Suspend')}
                  </button>
                )}
                {guild.is_banned ? (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(guild, 'unban')} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                    {t('admin.guilds.unban', 'Unban')}
                  </button>
                ) : (
                  <button type="button" disabled={patchAction.isPending} onClick={() => setBanTarget(guild)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                    {t('admin.rooms.ban', 'Ban')}
                  </button>
                )}
                <button type="button" disabled={deleteAction.isPending} onClick={() => setDeleteTarget(guild)} className="rounded-lg bg-danger-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                  {t('admin.rooms.delete', 'Delete')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>

      {status === 'success' && (data.guilds.length > 0 || pageIndex > 0) && (
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">
            {t('admin.pagination.prev', 'Prev')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!data?.nextCursor) return;
              setCursorHistory((h) => [...h.slice(0, pageIndex + 1), data.nextCursor!]);
              setPageIndex((i) => i + 1);
            }}
            disabled={!data?.hasNextPage}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
          >
            {t('admin.pagination.next', 'Next')}
          </button>
        </div>
      )}

      {editTarget && (
        <EditOverlay
          guild={editTarget}
          onClose={() => setEditTarget(null)}
          pending={patchAction.isPending}
          onSave={(payload) => patchAction.mutate({ id: editTarget.id, payload })}
        />
      )}

      {membersTarget && (
        <MembersOverlay
          guild={membersTarget}
          onClose={() => setMembersTarget(null)}
          pending={patchAction.isPending}
          onTransfer={(newCaptainUserId) => patchAction.mutate({ id: membersTarget.id, payload: { action: 'transfer_captain', newCaptainUserId } })}
          onRemove={(userId) => patchAction.mutate({ id: membersTarget.id, payload: { action: 'remove_member', userId } })}
        />
      )}

      {suspendTarget && (
        <AdminConfirmDialog
          title={t('admin.rooms.suspend', 'Suspend')}
          confirmLabel={t('common.confirm', 'Confirm')}
          cancelLabel={t('common.cancel', 'Cancel')}
          danger
          pending={patchAction.isPending}
          onCancel={() => { setSuspendTarget(null); setReason(''); }}
          onConfirm={() => reason.trim() && patchAction.mutate({ id: suspendTarget.id, payload: { action: 'suspend', reason: reason.trim() } })}
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('admin.rooms.suspendReason', 'Suspension reason')}
            rows={2}
            className={`${adminInputClass} resize-none text-sm`}
          />
        </AdminConfirmDialog>
      )}

      {banTarget && (
        <AdminConfirmDialog
          title={t('admin.rooms.ban', 'Ban')}
          description={t('admin.rooms.banConfirm', 'This will deactivate the guild and mark it as banned.')}
          confirmLabel={t('admin.rooms.ban', 'Ban')}
          cancelLabel={t('common.cancel', 'Cancel')}
          danger
          pending={patchAction.isPending}
          onCancel={() => setBanTarget(null)}
          onConfirm={() => patchAction.mutate({ id: banTarget.id, payload: { action: 'ban' } })}
        />
      )}

      {deleteTarget && (
        <AdminConfirmDialog
          title={t('admin.rooms.delete', 'Delete')}
          description={t('admin.guilds.deleteConfirm', 'This action is irreversible. The guild will be soft-deleted and all members removed.')}
          confirmLabel={t('admin.rooms.delete', 'Delete')}
          cancelLabel={t('common.cancel', 'Cancel')}
          danger
          pending={deleteAction.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteAction.mutate(deleteTarget.id)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/guilds')({
  component: AdminGuildsPage,
});
