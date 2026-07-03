/**
 * apps/android/src/routes/admin/branded-rooms.tsx
 *
 * Branded / Sponsored Rooms admin — mirrors
 * apps/web/app/(admin)/admin/branded-rooms/page.tsx: create/edit sponsorships,
 * toggle active, delete, plus a broadcast action (POST .../broadcast) that the
 * web page's UI doesn't surface yet but the backend already supports.
 *
 * NOTE on response shape: unlike most /api/admin/* endpoints, GET/POST
 * /api/admin/branded-rooms and PATCH/DELETE .../[id] return raw JSON (no
 * {success,data,error} envelope) — see apps/web/app/api/admin/branded-rooms/route.ts.
 * apiClient's response interceptor only unwraps bodies shaped like
 * {success,data}, so these responses pass through unchanged; handled explicitly
 * below. The broadcast endpoint IS enveloped, so it unwraps normally.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';
import {
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  AdminConfirmDialog,
  AdminField,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

interface BrandedRoom {
  id: string;
  roomId: string | null;
  roomName: string | null;
  roomType: string | null;
  brandName: string;
  brandLogoUrl: string | null;
  sponsorBudgetCoins: number;
  joinBonusCoins: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

type RoomStatus = 'active' | 'inactive' | 'scheduled' | 'ended';
type TargetType = 'room_members' | 'creator_followers';

interface FormState {
  brandName: string;
  brandLogoUrl: string;
  roomId: string;
  sponsorBudgetCoins: string;
  joinBonusCoins: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  brandName: '',
  brandLogoUrl: '',
  roomId: '',
  sponsorBudgetCoins: '10000',
  joinBonusCoins: '50',
  startsAt: '',
  endsAt: '',
  isActive: true,
};

function getRoomStatus(room: BrandedRoom): RoomStatus {
  const now = Date.now();
  if (room.startsAt && new Date(room.startsAt).getTime() > now) return 'scheduled';
  if (room.endsAt && new Date(room.endsAt).getTime() < now) return 'ended';
  return room.isActive ? 'active' : 'inactive';
}

const STATUS_COLOR: Record<RoomStatus, 'green' | 'neutral' | 'blue' | 'gold'> = {
  active: 'green',
  inactive: 'neutral',
  scheduled: 'blue',
  ended: 'gold',
};

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 16);
}

function formToPayload(f: FormState) {
  return {
    brandName: f.brandName.trim(),
    brandLogoUrl: f.brandLogoUrl.trim() || null,
    roomId: f.roomId.trim() || null,
    sponsorBudgetCoins: Number(f.sponsorBudgetCoins) || 0,
    joinBonusCoins: Number(f.joinBonusCoins) || 0,
    isActive: f.isActive,
    startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
    endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
  };
}

async function fetchBrandedRooms(): Promise<BrandedRoom[]> {
  const { data } = await apiClient.get<{ brandedRooms: BrandedRoom[] }>('/admin/branded-rooms');
  return data?.brandedRooms ?? [];
}

// ---------------------------------------------------------------------------
// Create / Edit overlay
// ---------------------------------------------------------------------------

function FormOverlay({
  title,
  initial,
  onClose,
  onSave,
  pending,
  showActiveToggle,
}: {
  title: string;
  initial: FormState;
  onClose: () => void;
  onSave: (form: FormState) => void;
  pending: boolean;
  showActiveToggle: boolean;
}) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [form, setForm] = useState<FormState>(initial);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        <button onClick={onClose} aria-label={t('nav.closeMenu')} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3.5 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <AdminField label={t('admin.brandedRooms.brandName', 'Brand Name')}>
          <input value={form.brandName} onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))} placeholder="Acme Corp" className={adminInputClass} />
        </AdminField>
        <AdminField label={t('admin.brandedRooms.brandLogoUrl', 'Brand Logo URL')}>
          <input type="url" value={form.brandLogoUrl} onChange={(e) => setForm((f) => ({ ...f, brandLogoUrl: e.target.value }))} placeholder="https://example.com/logo.png" className={adminInputClass} />
        </AdminField>
        <AdminField label={t('admin.brandedRooms.roomId', 'Room ID (optional)')}>
          <input value={form.roomId} onChange={(e) => setForm((f) => ({ ...f, roomId: e.target.value }))} placeholder={t('admin.brandedRooms.roomIdPlaceholder', 'UUID of the room to sponsor')} className={adminInputClass} />
        </AdminField>
        <AdminField label={t('admin.brandedRooms.joinBonus', 'Join Bonus ({{unit}})', { unit: currency.softPlural.toLowerCase() })}>
          <input type="number" min={0} value={form.joinBonusCoins} onChange={(e) => setForm((f) => ({ ...f, joinBonusCoins: e.target.value }))} className={adminInputClass} />
        </AdminField>
        <AdminField label={t('admin.brandedRooms.sponsorBudget', 'Sponsor Budget ({{unit}})', { unit: currency.softPlural.toLowerCase() })}>
          <input type="number" min={0} value={form.sponsorBudgetCoins} onChange={(e) => setForm((f) => ({ ...f, sponsorBudgetCoins: e.target.value }))} className={adminInputClass} />
        </AdminField>
        <div className="grid grid-cols-2 gap-2.5">
          <AdminField label={t('admin.brandedRooms.startsAt', 'Starts At')}>
            <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.brandedRooms.endsAt', 'Ends At')}>
            <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} className={adminInputClass} />
          </AdminField>
        </div>
        {showActiveToggle && (
          <label className="flex items-center gap-2.5 text-sm font-medium text-neutral-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded border-neutral-300" />
            {t('admin.brandedRooms.active', 'Active')}
          </label>
        )}

        <button
          type="button"
          disabled={pending || !form.brandName.trim()}
          onClick={() => onSave(form)}
          className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? '…' : t('common.confirm', 'Confirm')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broadcast overlay
// ---------------------------------------------------------------------------

function BroadcastOverlay({ room, onClose, onSend, pending }: { room: BrandedRoom; onClose: () => void; onSend: (message: string, targetType: TargetType, coinBonus: number) => void; pending: boolean }) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [message, setMessage] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('room_members');
  const [coinBonus, setCoinBonus] = useState('0');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="mb-1 text-base font-bold text-neutral-900">{t('admin.brandedRooms.broadcastTitle', 'Broadcast — {{brand}}', { brand: room.brandName })}</h3>
        <p className="mb-3 text-xs text-neutral-500">{t('admin.brandedRooms.broadcastHint', 'Send a sponsored message to this room. Coin bonus is deducted from the sponsor budget.')}</p>
        <div className="space-y-3">
          <AdminField label={t('admin.brandedRooms.message', 'Message')}>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500} className={`${adminInputClass} resize-none`} />
          </AdminField>
          <AdminField label={t('admin.brandedRooms.targetType', 'Target')}>
            <select value={targetType} onChange={(e) => setTargetType(e.target.value as TargetType)} className={adminInputClass}>
              <option value="room_members">{t('admin.brandedRooms.targetRoomMembers', 'Room Members')}</option>
              <option value="creator_followers">{t('admin.brandedRooms.targetCreatorFollowers', 'Creator Followers')}</option>
            </select>
          </AdminField>
          <AdminField label={t('admin.brandedRooms.coinBonus', 'Coin Bonus per Recipient ({{unit}})', { unit: currency.softPlural.toLowerCase() })}>
            <input type="number" min={0} max={100} value={coinBonus} onChange={(e) => setCoinBonus(e.target.value)} className={adminInputClass} />
          </AdminField>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={pending || !message.trim()}
            onClick={() => onSend(message.trim(), targetType, Number(coinBonus) || 0)}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? '…' : t('admin.brandedRooms.send', 'Send')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function AdminBrandedRoomsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currency = useCurrency();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BrandedRoom | null>(null);
  const [broadcasting, setBroadcasting] = useState<BrandedRoom | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandedRoom | null>(null);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: rooms, status, refetch } = useQuery({ queryKey: ['admin', 'branded-rooms'], queryFn: fetchBrandedRooms });

  const create = useMutation({
    mutationFn: (form: FormState) => apiClient.post('/admin/branded-rooms', formToPayload(form)),
    onSuccess: () => {
      showToast(t('admin.brandedRooms.created', 'Branded room created'));
      qc.invalidateQueries({ queryKey: ['admin', 'branded-rooms'] });
      setCreating(false);
    },
    onError: () => showToast(t('admin.brandedRooms.saveFailed', 'Failed to save'), 'error'),
  });

  const update = useMutation({
    mutationFn: ({ id, form }: { id: string; form: FormState }) => apiClient.patch(`/admin/branded-rooms/${id}`, formToPayload(form)),
    onSuccess: () => {
      showToast(t('admin.brandedRooms.updated', 'Branded room updated'));
      qc.invalidateQueries({ queryKey: ['admin', 'branded-rooms'] });
      setEditing(null);
    },
    onError: () => showToast(t('admin.brandedRooms.saveFailed', 'Failed to save'), 'error'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => {
      setToggleBusyId(id);
      return apiClient.patch(`/admin/branded-rooms/${id}`, { isActive });
    },
    onSuccess: (_res, vars) => {
      showToast(vars.isActive ? t('admin.brandedRooms.activated', 'Sponsorship activated') : t('admin.brandedRooms.deactivated', 'Sponsorship deactivated'));
      qc.invalidateQueries({ queryKey: ['admin', 'branded-rooms'] });
    },
    onError: () => showToast(t('admin.brandedRooms.saveFailed', 'Failed to save'), 'error'),
    onSettled: () => setToggleBusyId(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/branded-rooms/${id}`),
    onSuccess: () => {
      showToast(t('admin.brandedRooms.deleted', 'Sponsorship deleted'));
      qc.invalidateQueries({ queryKey: ['admin', 'branded-rooms'] });
      setDeleteTarget(null);
    },
    onError: () => showToast(t('admin.brandedRooms.saveFailed', 'Failed to save'), 'error'),
  });

  const broadcast = useMutation({
    mutationFn: ({ id, message, targetType, coinBonus }: { id: string; message: string; targetType: TargetType; coinBonus: number }) =>
      apiClient.post<{ recipientCount: number; totalCoinCost: number }>(`/admin/branded-rooms/${id}/broadcast`, {
        message,
        targetType,
        coinBonusPerRecipient: coinBonus,
      }),
    onSuccess: (res) => {
      showToast(t('admin.brandedRooms.broadcastSent', 'Broadcast sent to {{count}} recipients', { count: res.data.recipientCount }));
      qc.invalidateQueries({ queryKey: ['admin', 'branded-rooms'] });
      setBroadcasting(null);
    },
    onError: () => showToast(t('admin.brandedRooms.broadcastFailed', 'Broadcast failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.brandedRooms', 'Branded Rooms')}</h1>
        <button type="button" onClick={() => setCreating(true)} className="shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white">
          {t('admin.brandedRooms.new', '+ New')}
        </button>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        {t('admin.brandedRooms.description', 'Companies sponsor a dedicated Room. Members who join earn a {{unit}} bonus funded by the brand.', { unit: currency.softSingular.toLowerCase() })}
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (rooms?.length ?? 0) === 0 && (
          <AdminEmptyState icon="🏠" title={t('admin.brandedRooms.empty', 'No branded rooms yet')} hint={t('admin.brandedRooms.emptyHint', 'Tap "+ New" to create a sponsorship.')} />
        )}

        {status === 'success' &&
          rooms?.map((room) => {
            const st = getRoomStatus(room);
            return (
              <AdminCard key={room.id}>
                <div className="mb-1.5 flex items-center gap-2">
                  {room.brandLogoUrl && <img src={room.brandLogoUrl} alt={room.brandName} className="h-6 w-6 shrink-0 rounded object-contain" />}
                  <p className="font-semibold text-neutral-900 truncate">{room.brandName}</p>
                  <AdminBadge label={st} color={STATUS_COLOR[st]} />
                </div>
                <p className="mb-1 text-xs text-neutral-500">
                  {room.roomName ? `${room.roomName}${room.roomType ? ` (${room.roomType})` : ''}` : t('admin.brandedRooms.unlinked', 'Unlinked')}
                </p>
                <p className="mb-1.5 text-xs text-neutral-500">
                  {t('admin.brandedRooms.joinBonus', 'Join Bonus ({{unit}})', { unit: currency.softPlural.toLowerCase() })}: {room.joinBonusCoins.toLocaleString()} · {t('admin.brandedRooms.sponsorBudget', 'Sponsor Budget ({{unit}})', { unit: currency.softPlural.toLowerCase() })}: {room.sponsorBudgetCoins.toLocaleString()}
                </p>
                <p className="mb-2.5 text-[10px] text-neutral-400">{fmtDate(room.startsAt)} — {fmtDate(room.endsAt)}</p>

                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setEditing(room)} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {t('admin.brandedRooms.edit', 'Edit')}
                  </button>
                  <button
                    type="button"
                    disabled={toggleBusyId === room.id}
                    onClick={() => toggle.mutate({ id: room.id, isActive: !room.isActive })}
                    className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                  >
                    {toggleBusyId === room.id ? '…' : room.isActive ? t('admin.brandedRooms.deactivate', 'Deactivate') : t('admin.brandedRooms.activate', 'Activate')}
                  </button>
                  <button type="button" onClick={() => setBroadcasting(room)} className="rounded-lg bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700">
                    {t('admin.brandedRooms.broadcast', 'Broadcast')}
                  </button>
                  <button type="button" onClick={() => setDeleteTarget(room)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700">
                    {t('admin.brandedRooms.delete', 'Delete')}
                  </button>
                </div>
              </AdminCard>
            );
          })}
      </div>

      {creating && (
        <FormOverlay
          title={t('admin.brandedRooms.newTitle', 'New Branded Room Sponsorship')}
          initial={EMPTY_FORM}
          onClose={() => setCreating(false)}
          onSave={(form) => create.mutate(form)}
          pending={create.isPending}
          showActiveToggle={false}
        />
      )}

      {editing && (
        <FormOverlay
          title={t('admin.brandedRooms.editTitle', 'Edit Sponsorship — {{brand}}', { brand: editing.brandName })}
          initial={{
            brandName: editing.brandName,
            brandLogoUrl: editing.brandLogoUrl ?? '',
            roomId: editing.roomId ?? '',
            sponsorBudgetCoins: String(editing.sponsorBudgetCoins),
            joinBonusCoins: String(editing.joinBonusCoins),
            startsAt: toDateInput(editing.startsAt),
            endsAt: toDateInput(editing.endsAt),
            isActive: editing.isActive,
          }}
          onClose={() => setEditing(null)}
          onSave={(form) => update.mutate({ id: editing.id, form })}
          pending={update.isPending}
          showActiveToggle
        />
      )}

      {broadcasting && (
        <BroadcastOverlay
          room={broadcasting}
          onClose={() => setBroadcasting(null)}
          pending={broadcast.isPending}
          onSend={(message, targetType, coinBonus) => broadcast.mutate({ id: broadcasting.id, message, targetType, coinBonus })}
        />
      )}

      {deleteTarget && (
        <AdminConfirmDialog
          title={t('admin.brandedRooms.deleteTitle', 'Delete this sponsorship?')}
          description={t('admin.brandedRooms.deleteConfirm', 'This cannot be undone.')}
          confirmLabel={t('admin.brandedRooms.delete', 'Delete')}
          cancelLabel={t('common.cancel', 'Cancel')}
          danger
          pending={remove.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/branded-rooms')({
  component: AdminBrandedRoomsPage,
});
