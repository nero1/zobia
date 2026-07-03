/**
 * apps/android/src/routes/admin/flash-xp.tsx
 *
 * Flash XP events — mirrors apps/web/app/(admin)/admin/flash-xp/page.tsx.
 * GET /admin/flash-xp -> {success,data:{events}} (auto-unwrapped),
 * POST /admin/flash-xp { name, description?, announced_at, fires_at, ends_at, multiplier }.
 *
 * BUG FIX (see the web page fix in this same change): the backend requires
 * fires_at to be at least 6 hours after announced_at (PRD §2.4) and 400s
 * otherwise — the web page's client-side check and defaults only enforced a
 * 1-hour gap. This page uses the correct 6-hour minimum from the start.
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
  AdminField,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

interface FlashXpEvent {
  id: string;
  name: string;
  description: string | null;
  announced_at: string;
  fires_at: string;
  ends_at: string;
  multiplier: number;
  fired: boolean;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;

function toLocalDatetimeValue(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 16);
}

function defaultForm() {
  return {
    name: '',
    description: '',
    announced_at: toLocalDatetimeValue(ONE_HOUR_MS),
    fires_at: toLocalDatetimeValue(7 * ONE_HOUR_MS),
    ends_at: toLocalDatetimeValue(9 * ONE_HOUR_MS),
    multiplier: '2',
  };
}

function eventStatus(event: FlashXpEvent, t: (k: string, d: string) => string): { label: string; color: 'neutral' | 'teal' | 'gold' | 'blue' } {
  const now = Date.now();
  const fires = new Date(event.fires_at).getTime();
  const ends = new Date(event.ends_at).getTime();
  const announced = new Date(event.announced_at).getTime();
  if (now > ends) return { label: t('admin.flashXp.ended', 'Ended'), color: 'neutral' };
  if (now >= fires) return { label: t('admin.flashXp.active', 'Active'), color: 'teal' };
  if (now >= announced) return { label: t('admin.flashXp.announced', 'Announced'), color: 'gold' };
  return { label: t('admin.flashXp.upcoming', 'Upcoming'), color: 'blue' };
}

async function fetchEvents(): Promise<FlashXpEvent[]> {
  const { data } = await apiClient.get<{ events: FlashXpEvent[] }>('/admin/flash-xp');
  return data?.events ?? [];
}

function AdminFlashXpPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: events, status, refetch } = useQuery({ queryKey: ['admin', 'flash-xp'], queryFn: fetchEvents });

  const create = useMutation({
    mutationFn: () =>
      apiClient.post('/admin/flash-xp', {
        name: form.name,
        description: form.description || undefined,
        announced_at: new Date(form.announced_at).toISOString(),
        fires_at: new Date(form.fires_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        multiplier: parseFloat(form.multiplier) || 2.0,
      }),
    onSuccess: () => {
      showToast(t('admin.flashXp.created', 'Flash XP event created!'));
      setShowForm(false);
      setForm(defaultForm());
      qc.invalidateQueries({ queryKey: ['admin', 'flash-xp'] });
    },
    onError: () => setFormError(t('admin.flashXp.createFailed', 'Failed to create event')),
  });

  const handleSubmit = () => {
    const announcedAt = new Date(form.announced_at);
    const firesAt = new Date(form.fires_at);
    const endsAt = new Date(form.ends_at);

    if (announcedAt >= firesAt) {
      setFormError(t('admin.flashXp.errorOrder1', 'Announced At must be before Fires At.'));
      return;
    }
    if (firesAt >= endsAt) {
      setFormError(t('admin.flashXp.errorOrder2', 'Fires At must be before Ends At.'));
      return;
    }
    if (firesAt.getTime() - announcedAt.getTime() < SIX_HOURS_MS) {
      setFormError(t('admin.flashXp.errorGap', 'Fires At must be at least 6 hours after Announced At.'));
      return;
    }
    setFormError(null);
    create.mutate();
  };

  return (
    <div className="px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.flashXp', 'Flash XP Events')}</h1>
        <button
          type="button"
          onClick={() => { setShowForm((v) => !v); setFormError(null); }}
          className="shrink-0 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
        >
          {showForm ? t('common.cancel') : t('admin.flashXp.new', '+ New Event')}
        </button>
      </div>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-800">
        {t('admin.flashXp.timingInfo', 'Announced hours before firing (min 6h). Fires At is kept secret from users — they only see the announcement window.')}
      </div>

      {showForm && (
        <AdminCard>
          <div className="space-y-3">
            <AdminField label={t('admin.flashXp.name', 'Name')}>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={150} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.flashXp.description', 'Description')}>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} maxLength={500} className={`${adminInputClass} resize-none`} />
            </AdminField>
            <AdminField label={t('admin.flashXp.announcedAt', 'Announced At (shown publicly)')}>
              <input type="datetime-local" value={form.announced_at} onChange={(e) => setForm((f) => ({ ...f, announced_at: e.target.value }))} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.flashXp.firesAt', 'Fires At (secret — min 6h after announced)')}>
              <input type="datetime-local" value={form.fires_at} onChange={(e) => setForm((f) => ({ ...f, fires_at: e.target.value }))} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.flashXp.endsAt', 'Ends At')}>
              <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.flashXp.multiplier', 'XP Multiplier')}>
              <input type="number" min={1} max={5} step={0.5} value={form.multiplier} onChange={(e) => setForm((f) => ({ ...f, multiplier: e.target.value }))} className={adminInputClass} />
            </AdminField>

            {formError && <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{formError}</p>}

            <button
              type="button"
              disabled={!form.name.trim() || create.isPending}
              onClick={handleSubmit}
              className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {create.isPending ? t('admin.flashXp.creating', 'Creating…') : t('admin.flashXp.create', 'Create Flash XP Event')}
            </button>
          </div>
        </AdminCard>
      )}

      <div className="mt-4 space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (events?.length ?? 0) === 0 && <AdminEmptyState icon="⚡" title={t('admin.flashXp.empty', 'No flash XP events yet')} />}
        {status === 'success' &&
          events?.map((event) => {
            const s = eventStatus(event, t);
            return (
              <AdminCard key={event.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-neutral-900">{event.name}</p>
                    {event.description && <p className="truncate text-xs text-neutral-500">{event.description}</p>}
                  </div>
                  <AdminBadge label={s.label} color={s.color} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {event.multiplier > 1 && <AdminBadge label={`${event.multiplier}x`} color="gold" />}
                  {event.fired && <AdminBadge label={t('admin.flashXp.fired', 'Fired')} color="teal" />}
                </div>
                <p className="mt-1.5 text-[11px] text-neutral-400">
                  {t('admin.flashXp.announcedAt', 'Announced At')}: {fmtDate(event.announced_at)} · {t('admin.flashXp.firesAt', 'Fires At')}: {fmtDate(event.fires_at)} · {t('admin.flashXp.endsAt', 'Ends At')}: {fmtDate(event.ends_at)}
                </p>
              </AdminCard>
            );
          })}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/flash-xp')({
  component: AdminFlashXpPage,
});
