/**
 * apps/android/src/routes/admin/leaderboard-banners.tsx
 *
 * Sponsored Leaderboard Banners admin — mirrors
 * apps/web/app/(admin)/admin/leaderboard-banners/page.tsx: list, create,
 * activate/deactivate (only one banner can be active at a time — server
 * enforced), delete.
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
  fmtNumber,
} from '@/components/admin/AdminUI';

interface SponsoredBanner {
  id: string;
  sponsorName: string;
  sponsorLogoUrl: string | null;
  ctaText: string;
  ctaUrl: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  impressions: number;
}

interface BannerFormData {
  sponsorName: string;
  sponsorLogoUrl: string;
  ctaText: string;
  ctaUrl: string;
  startsAt: string;
  endsAt: string;
}

function defaultForm(): BannerFormData {
  return { sponsorName: '', sponsorLogoUrl: '', ctaText: '', ctaUrl: '', startsAt: '', endsAt: '' };
}

async function fetchBanners(): Promise<SponsoredBanner[]> {
  const { data } = await apiClient.get<{ banners: SponsoredBanner[] }>('/admin/leaderboard-banners');
  return data?.banners ?? [];
}

function BannerFormModal({ onSave, onClose, saving }: { onSave: (form: BannerFormData) => void; onClose: () => void; saving: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<BannerFormData>(defaultForm());

  function set<K extends keyof BannerFormData>(key: K, value: BannerFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="mb-4 text-base font-bold text-neutral-900">{t('admin.leaderboardBanners.createTitle', 'Create Sponsored Banner')}</h3>
        <div className="space-y-3">
          <AdminField label={t('admin.leaderboardBanners.sponsorName', 'Sponsor Name')}>
            <input type="text" value={form.sponsorName} onChange={(e) => set('sponsorName', e.target.value)} placeholder="Acme Corp" className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.leaderboardBanners.logoUrl', 'Sponsor Logo URL (optional)')}>
            <input type="url" value={form.sponsorLogoUrl} onChange={(e) => set('sponsorLogoUrl', e.target.value)} placeholder="https://example.com/logo.png" className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.leaderboardBanners.ctaText', 'CTA Text')}>
            <input type="text" value={form.ctaText} onChange={(e) => set('ctaText', e.target.value)} placeholder="Learn More" className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.leaderboardBanners.ctaUrl', 'CTA URL')}>
            <input type="url" value={form.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)} placeholder="https://example.com/offer" className={adminInputClass} />
          </AdminField>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label={t('admin.events.startsAt', 'Starts At')}>
              <input type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.events.endsAt', 'Ends At')}>
              <input type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} className={adminInputClass} />
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
            disabled={saving || !form.sponsorName.trim() || !form.ctaText.trim() || !form.ctaUrl.trim() || !form.startsAt || !form.endsAt}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '…' : t('admin.leaderboardBanners.create', 'Create Banner')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminLeaderboardBannersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<SponsoredBanner | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'leaderboard-banners'], queryFn: fetchBanners });

  const createMutation = useMutation({
    mutationFn: (form: BannerFormData) =>
      apiClient.post('/admin/leaderboard-banners', {
        sponsorName: form.sponsorName,
        sponsorLogoUrl: form.sponsorLogoUrl || null,
        ctaText: form.ctaText,
        ctaUrl: form.ctaUrl,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      }),
    onSuccess: () => {
      showToast(t('admin.leaderboardBanners.created', 'Banner created'));
      setShowModal(false);
      qc.invalidateQueries({ queryKey: ['admin', 'leaderboard-banners'] });
    },
    onError: () => showToast(t('admin.leaderboardBanners.createFailed', 'Failed to create banner'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiClient.patch(`/admin/leaderboard-banners/${id}`, { isActive }),
    onSuccess: () => {
      showToast(t('admin.events.updated', 'Banner updated'));
      qc.invalidateQueries({ queryKey: ['admin', 'leaderboard-banners'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/leaderboard-banners/${id}`),
    onSuccess: () => {
      showToast(t('admin.leaderboardBanners.deleted', 'Banner deleted'));
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'leaderboard-banners'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.leaderboardBanners', 'Leaderboard Banners')}</h1>
        <button type="button" onClick={() => setShowModal(true)} className="rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white">
          + {t('admin.leaderboardBanners.create', 'Create')}
        </button>
      </div>
      <p className="mb-4 text-xs text-neutral-500">{t('admin.leaderboardBanners.subtitle', 'Only one banner can be active at a time.')}</p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (data?.length ?? 0) === 0 && <AdminEmptyState icon="🏆" title={t('admin.leaderboardBanners.empty', 'No sponsored banners yet')} />}
        {status === 'success' &&
          data?.map((banner) => (
            <AdminCard key={banner.id}>
              <div className="flex items-start gap-3">
                {banner.sponsorLogoUrl && (
                  <img src={banner.sponsorLogoUrl} alt={banner.sponsorName} className="h-9 w-9 shrink-0 rounded object-contain" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900 truncate">{banner.sponsorName}</p>
                    <AdminBadge label={banner.isActive ? t('admin.events.active', 'Active') : t('admin.events.inactive', 'Inactive')} color={banner.isActive ? 'green' : 'neutral'} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">{banner.ctaText} → {banner.ctaUrl}</p>
                  <p className="mt-1 text-[11px] text-neutral-400">
                    {fmtDate(banner.startsAt)} – {fmtDate(banner.endsAt)} · {fmtNumber(banner.impressions)} {t('admin.leaderboardBanners.impressions', 'impressions')}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate({ id: banner.id, isActive: !banner.isActive })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${banner.isActive ? 'bg-neutral-100 text-neutral-700' : 'bg-success-100 text-success-700'}`}
                >
                  {banner.isActive ? t('admin.events.deactivate', 'Deactivate') : t('admin.events.activate', 'Activate')}
                </button>
                <button type="button" onClick={() => setDeleting(banner)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700">
                  {t('common.delete', 'Delete')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>

      {showModal && <BannerFormModal onSave={(form) => createMutation.mutate(form)} onClose={() => setShowModal(false)} saving={createMutation.isPending} />}

      {deleting && (
        <AdminConfirmDialog
          title={t('admin.leaderboardBanners.confirmDelete', 'Delete this sponsored banner?')}
          confirmLabel={t('common.delete', 'Delete')}
          cancelLabel={t('common.cancel')}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/leaderboard-banners')({
  component: AdminLeaderboardBannersPage,
});
