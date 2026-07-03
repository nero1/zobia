/**
 * apps/android/src/routes/admin/events.tsx
 *
 * Platform Events admin — mirrors apps/web/app/(admin)/admin/events/page.tsx:
 * list, create, activate/deactivate toggle, and deactivate (soft-delete).
 * Manages platform-wide events (flash XP, cultural, season launches, etc),
 * distinct from the read-only user-facing /events page already in this app.
 *
 * NOTE: the web page's create form has a latent contract bug — it POSTs
 * `type` with values like "xp_boost"/"seasonal" while the backend's Zod
 * schema (app/api/admin/events/route.ts) expects `event_type` with values
 * "cultural"|"season_launch"|"flash_xp"|"guild_war_event"|"mystery_drop"|
 * "platform" — every web "Create Event" click 400s. This page uses the
 * correct backend contract from the start.
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
  AdminConfirmDialog,
  AdminField,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

type EventType = 'cultural' | 'season_launch' | 'flash_xp' | 'guild_war_event' | 'mystery_drop' | 'platform';

interface PlatformEvent {
  id: string;
  name: string;
  description: string | null;
  event_type: EventType;
  xpMultiplier: number;
  coin_bonus_pct: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_at: string;
}

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'cultural', label: 'Cultural' },
  { value: 'season_launch', label: 'Season Launch' },
  { value: 'flash_xp', label: 'Flash XP' },
  { value: 'guild_war_event', label: 'Guild War Event' },
  { value: 'mystery_drop', label: 'Mystery Drop' },
  { value: 'platform', label: 'Platform' },
];

interface EventFormData {
  name: string;
  event_type: EventType;
  description: string;
  starts_at: string;
  ends_at: string;
  xp_multiplier: number;
  coin_bonus_pct: number;
}

function defaultFormData(): EventFormData {
  const now = new Date();
  const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    name: '',
    event_type: 'flash_xp',
    description: '',
    starts_at: now.toISOString().slice(0, 16),
    ends_at: later.toISOString().slice(0, 16),
    xp_multiplier: 2,
    coin_bonus_pct: 0,
  };
}

async function fetchEvents(): Promise<PlatformEvent[]> {
  const { data } = await apiClient.get<{ events: PlatformEvent[] }>('/admin/events');
  return data?.events ?? [];
}

function EventFormModal({
  onSave,
  onClose,
  saving,
}: {
  onSave: (data: EventFormData) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<EventFormData>(defaultFormData());

  function update<K extends keyof EventFormData>(key: K, value: EventFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="mb-4 text-base font-bold text-neutral-900">{t('admin.events.createTitle', 'Create Event')}</h3>
        <div className="space-y-3">
          <AdminField label={t('admin.events.name', 'Event Name')}>
            <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)} maxLength={150} className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.events.type', 'Type')}>
            <select value={form.event_type} onChange={(e) => update('event_type', e.target.value as EventType)} className={adminInputClass}>
              {EVENT_TYPES.map((et) => (
                <option key={et.value} value={et.value}>{et.label}</option>
              ))}
            </select>
          </AdminField>
          <AdminField label={t('admin.events.description', 'Description')}>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} rows={2} maxLength={1000} className={`${adminInputClass} resize-none`} />
          </AdminField>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label={t('admin.events.startsAt', 'Starts At')}>
              <input type="datetime-local" value={form.starts_at} onChange={(e) => update('starts_at', e.target.value)} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.events.endsAt', 'Ends At')}>
              <input type="datetime-local" value={form.ends_at} onChange={(e) => update('ends_at', e.target.value)} className={adminInputClass} />
            </AdminField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label={t('admin.events.xpMultiplier', 'XP Multiplier')}>
              <input type="number" value={form.xp_multiplier} onChange={(e) => update('xp_multiplier', parseFloat(e.target.value) || 1)} min={0.5} max={10} step={0.5} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.events.coinBonus', 'Coin Bonus %')}>
              <input type="number" value={form.coin_bonus_pct} onChange={(e) => update('coin_bonus_pct', parseInt(e.target.value, 10) || 0)} min={0} max={100} className={adminInputClass} />
            </AdminField>
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSave(form)}
            disabled={saving || !form.name.trim()}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '…' : t('admin.events.save', 'Save Event')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminEventsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [deactivating, setDeactivating] = useState<PlatformEvent | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'events'], queryFn: fetchEvents });

  const createMutation = useMutation({
    mutationFn: (form: EventFormData) =>
      apiClient.post('/admin/events', {
        name: form.name,
        event_type: form.event_type,
        description: form.description || undefined,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        xp_multiplier: form.xp_multiplier,
        coin_bonus_pct: form.coin_bonus_pct,
      }),
    onSuccess: () => {
      showToast(t('admin.events.created', 'Event created'));
      setShowModal(false);
      qc.invalidateQueries({ queryKey: ['admin', 'events'] });
    },
    onError: () => showToast(t('admin.events.createFailed', 'Failed to create event'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiClient.patch(`/admin/events/${id}`, { is_active: isActive }),
    onSuccess: () => {
      showToast(t('admin.events.updated', 'Event updated'));
      qc.invalidateQueries({ queryKey: ['admin', 'events'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/events/${id}`),
    onSuccess: () => {
      showToast(t('admin.events.deactivated', 'Event deactivated'));
      setDeactivating(null);
      qc.invalidateQueries({ queryKey: ['admin', 'events'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.events', 'Platform Events')}</h1>
        <button type="button" onClick={() => setShowModal(true)} className="rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white">
          + {t('admin.events.create', 'Create')}
        </button>
      </div>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (data?.length ?? 0) === 0 && (
          <AdminEmptyState icon="📅" title={t('admin.events.empty', 'No events yet')} hint={t('admin.events.emptyHint', 'Create one to run a platform-wide XP boost or celebration.')} />
        )}
        {status === 'success' &&
          data?.map((ev) => (
            <AdminCard key={ev.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900 truncate">{ev.name}</p>
                    <AdminBadge label={ev.event_type.replace(/_/g, ' ')} color="blue" />
                    <AdminBadge label={ev.is_active ? t('admin.events.active', 'Active') : t('admin.events.inactive', 'Inactive')} color={ev.is_active ? 'green' : 'neutral'} />
                    {ev.xpMultiplier > 1 && <AdminBadge label={`${ev.xpMultiplier}x XP`} color="gold" />}
                  </div>
                  {ev.description && <p className="mt-0.5 text-xs text-neutral-500 line-clamp-2">{ev.description}</p>}
                  <p className="mt-1.5 text-[11px] text-neutral-400">{fmtDate(ev.starts_at)} – {fmtDate(ev.ends_at)}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate({ id: ev.id, isActive: !ev.is_active })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${ev.is_active ? 'bg-neutral-100 text-neutral-700' : 'bg-success-100 text-success-700'}`}
                >
                  {ev.is_active ? t('admin.events.deactivate', 'Deactivate') : t('admin.events.activate', 'Activate')}
                </button>
                {ev.is_active && (
                  <button type="button" onClick={() => setDeactivating(ev)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700">
                    {t('admin.events.end', 'End Event')}
                  </button>
                )}
              </div>
            </AdminCard>
          ))}
      </div>

      {showModal && <EventFormModal onSave={(form) => createMutation.mutate(form)} onClose={() => setShowModal(false)} saving={createMutation.isPending} />}

      {deactivating && (
        <AdminConfirmDialog
          title={t('admin.events.confirmEnd', 'End this event?')}
          description={t('admin.events.confirmEndDesc', 'This deactivates the event immediately.')}
          confirmLabel={t('admin.events.end', 'End Event')}
          cancelLabel={t('common.cancel')}
          danger
          pending={deactivateMutation.isPending}
          onCancel={() => setDeactivating(null)}
          onConfirm={() => deactivateMutation.mutate(deactivating.id)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/events')({
  component: AdminEventsPage,
});
