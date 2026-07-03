/**
 * apps/android/src/routes/admin/rooms.tsx
 *
 * Room Management admin — mirrors apps/web/app/(admin)/admin/rooms/page.tsx.
 * Search + status filter, cursor pagination, and a full action set matching
 * the backend's PATCH /api/admin/rooms/:roomId discriminated-union `action`
 * enum exactly (set_active/set_inactive/suspend/unsuspend/ban/flag/unflag/
 * disable_monetization/enable_monetization/update_details) plus DELETE.
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

type StatusFilter = 'all' | 'active' | 'inactive' | 'suspended' | 'banned' | 'flagged';
type RoomType = 'free_open' | 'vip' | 'drop' | 'tipping' | 'classroom' | 'guild';
const ROOM_TYPES: RoomType[] = ['free_open', 'vip', 'drop', 'tipping', 'classroom', 'guild'];
const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'inactive', 'suspended', 'banned', 'flagged'];

type SimpleAction = 'set_active' | 'set_inactive' | 'unsuspend' | 'ban' | 'unflag' | 'disable_monetization' | 'enable_monetization';
type ReasonAction = 'suspend' | 'flag';

interface AdminRoom {
  id: string;
  name: string;
  description: string | null;
  type: string;
  creator_username: string | null;
  member_count: number;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  is_banned: boolean;
  flagged_at: string | null;
  flag_reason: string | null;
  monetization_disabled: boolean;
  created_at: string;
}

async function fetchRooms(search: string, statusFilter: StatusFilter, cursor: string | undefined) {
  const params = new URLSearchParams({ limit: '20' });
  if (search) params.set('search', search);
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<{ rooms: AdminRoom[]; pagination: { hasNextPage: boolean; nextCursor: string | null } }>(`/admin/rooms?${params}`);
  return { rooms: data?.rooms ?? [], hasNextPage: data?.pagination?.hasNextPage ?? false, nextCursor: data?.pagination?.nextCursor ?? null };
}

function RoomStatusBadge({ room }: { room: AdminRoom }) {
  const { t } = useTranslation();
  if (room.is_banned) return <AdminBadge label={t('admin.rooms.status.banned', 'Banned')} color="red" />;
  if (room.is_suspended) return <AdminBadge label={t('admin.rooms.status.suspended', 'Suspended')} color="gold" />;
  if (room.flagged_at) return <AdminBadge label={t('admin.rooms.status.flagged', 'Flagged')} color="gold" />;
  if (room.is_active) return <AdminBadge label={t('admin.rooms.status.active', 'Active')} color="green" />;
  return <AdminBadge label={t('admin.rooms.status.inactive', 'Inactive')} color="neutral" />;
}

interface EditForm {
  name: string;
  description: string;
  type: RoomType;
  max_members: string;
}

function EditOverlay({ room, onClose, onSave, pending }: { room: AdminRoom; onClose: () => void; onSave: (payload: Record<string, unknown>) => void; pending: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<EditForm>({ name: room.name, description: room.description ?? '', type: room.type as RoomType, max_members: '' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="mb-4 text-base font-bold text-neutral-900">{t('admin.rooms.editDetails', 'Edit Details')}</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('admin.rooms.edit.name', 'Room Name')}</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={adminInputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('admin.rooms.edit.description', 'Description')}</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={`${adminInputClass} resize-none`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('admin.rooms.edit.type', 'Type')}</label>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as RoomType }))} className={adminInputClass}>
              {ROOM_TYPES.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('admin.rooms.edit.maxMembers', 'Max Members')}</label>
            <input type="number" min={2} max={10000} value={form.max_members} onChange={(e) => setForm((f) => ({ ...f, max_members: e.target.value }))} className={adminInputClass} />
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
              if (form.description !== (room.description ?? '')) payload.description = form.description.trim();
              if (form.type) payload.type = form.type;
              if (form.max_members) payload.max_members = parseInt(form.max_members, 10);
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

function AdminRoomsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [editTarget, setEditTarget] = useState<AdminRoom | null>(null);
  const [reasonTarget, setReasonTarget] = useState<{ room: AdminRoom; action: ReasonAction } | null>(null);
  const [reason, setReason] = useState('');
  const [banTarget, setBanTarget] = useState<AdminRoom | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRoom | null>(null);

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
    queryKey: ['admin', 'rooms', debouncedSearch, statusFilter, cursor],
    queryFn: () => fetchRooms(debouncedSearch, statusFilter, cursor),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'rooms'] });

  const patchAction = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) => apiClient.patch(`/admin/rooms/${id}`, payload),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      invalidate();
      setEditTarget(null);
      setReasonTarget(null);
      setReason('');
      setBanTarget(null);
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const deleteAction = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/rooms/${id}`),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      invalidate();
      setDeleteTarget(null);
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const doSimple = (room: AdminRoom, action: SimpleAction) => patchAction.mutate({ id: room.id, payload: { action } });

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.rooms.title', 'Room Management')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.rooms.search', 'Search rooms…')}
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
            {t(`admin.rooms.status.${s}`, s)}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && data.rooms.length === 0 && <AdminEmptyState icon="🏛" title={t('admin.rooms.empty', 'No rooms found')} />}

        {status === 'success' &&
          data.rooms.map((room) => (
            <AdminCard key={room.id}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <p className="font-semibold text-neutral-900 truncate">{room.name}</p>
                <RoomStatusBadge room={room} />
                <AdminBadge label={room.type} color="neutral" />
                {room.monetization_disabled && <AdminBadge label={t('admin.rooms.monetizationDisabled', 'Monetization disabled')} color="blue" />}
              </div>
              <p className="mb-1 text-xs text-neutral-500">
                @{room.creator_username ?? 'unknown'} · {room.member_count} · {fmtDate(room.created_at)}
              </p>
              {room.suspension_reason && <p className="mb-1 text-xs text-amber-600">{t('admin.rooms.suspendReason', 'Suspension reason')}: {room.suspension_reason}</p>}
              {room.flag_reason && <p className="mb-1 text-xs text-orange-600">{t('admin.rooms.flagReason', 'Flag reason')}: {room.flag_reason}</p>}

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => Browser.open({ url: `${env.VITE_WEB_BASE_URL}/rooms/${room.id}` })}
                  className="rounded-lg bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700"
                >
                  {t('admin.users.detail.viewProfile', 'View ↗')}
                </button>
                <button type="button" disabled={patchAction.isPending} onClick={() => setEditTarget(room)} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 disabled:opacity-50">
                  {t('admin.rooms.editDetails', 'Edit Details')}
                </button>
                {room.is_active ? (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(room, 'set_inactive')} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                    {t('admin.rooms.deactivate', 'Deactivate')}
                  </button>
                ) : (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(room, 'set_active')} className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700 disabled:opacity-50">
                    {t('admin.rooms.activate', 'Activate')}
                  </button>
                )}
                {room.is_suspended ? (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(room, 'unsuspend')} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 disabled:opacity-50">
                    {t('admin.rooms.unsuspend', 'Unsuspend')}
                  </button>
                ) : !room.is_banned && (
                  <button type="button" disabled={patchAction.isPending} onClick={() => { setReasonTarget({ room, action: 'suspend' }); setReason(''); }} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 disabled:opacity-50">
                    {t('admin.rooms.suspend', 'Suspend')}
                  </button>
                )}
                {!room.is_banned && (
                  <button type="button" disabled={patchAction.isPending} onClick={() => setBanTarget(room)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
                    {t('admin.rooms.ban', 'Ban')}
                  </button>
                )}
                {room.flagged_at ? (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(room, 'unflag')} className="rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700 disabled:opacity-50">
                    {t('admin.rooms.unflag', 'Unflag')}
                  </button>
                ) : (
                  <button type="button" disabled={patchAction.isPending} onClick={() => { setReasonTarget({ room, action: 'flag' }); setReason(''); }} className="rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700 disabled:opacity-50">
                    {t('admin.rooms.flag', 'Flag')}
                  </button>
                )}
                {room.monetization_disabled ? (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(room, 'enable_monetization')} className="rounded-lg bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700 disabled:opacity-50">
                    {t('admin.rooms.enableMonetization', 'Enable Monetization')}
                  </button>
                ) : (
                  <button type="button" disabled={patchAction.isPending} onClick={() => doSimple(room, 'disable_monetization')} className="rounded-lg bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700 disabled:opacity-50">
                    {t('admin.rooms.disableMonetization', 'Disable Monetization')}
                  </button>
                )}
                <button type="button" disabled={deleteAction.isPending} onClick={() => setDeleteTarget(room)} className="rounded-lg bg-danger-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                  {t('admin.rooms.delete', 'Delete')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>

      {status === 'success' && (data.rooms.length > 0 || pageIndex > 0) && (
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
          room={editTarget}
          onClose={() => setEditTarget(null)}
          pending={patchAction.isPending}
          onSave={(payload) => patchAction.mutate({ id: editTarget.id, payload })}
        />
      )}

      {reasonTarget && (
        <AdminConfirmDialog
          title={reasonTarget.action === 'suspend' ? t('admin.rooms.suspend', 'Suspend') : t('admin.rooms.flag', 'Flag')}
          confirmLabel={t('common.confirm', 'Confirm')}
          cancelLabel={t('common.cancel', 'Cancel')}
          danger
          pending={patchAction.isPending}
          onCancel={() => { setReasonTarget(null); setReason(''); }}
          onConfirm={() => reason.trim() && patchAction.mutate({ id: reasonTarget.room.id, payload: { action: reasonTarget.action, reason: reason.trim() } })}
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonTarget.action === 'suspend' ? t('admin.rooms.suspendReason', 'Suspension reason') : t('admin.rooms.flagReason', 'Flag reason')}
            rows={2}
            className={`${adminInputClass} resize-none text-sm`}
          />
        </AdminConfirmDialog>
      )}

      {banTarget && (
        <AdminConfirmDialog
          title={t('admin.rooms.ban', 'Ban')}
          description={t('admin.rooms.banConfirm', 'This will deactivate the room and mark it as banned.')}
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
          description={t('admin.rooms.deleteConfirm', 'This action is irreversible. The room will be soft-deleted.')}
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

export const Route = createFileRoute('/admin/rooms')({
  component: AdminRoomsPage,
});
