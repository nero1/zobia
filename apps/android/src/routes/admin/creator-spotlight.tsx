/**
 * apps/android/src/routes/admin/creator-spotlight.tsx
 *
 * Creator of the Month admin — mirrors
 * apps/web/app/(admin)/admin/creator-spotlight/page.tsx: list past/current
 * spotlights, add a new monthly spotlight by creator UUID.
 *
 * NOTE: unlike most /api/admin/* endpoints, GET/POST here do NOT use the
 * {success,data} envelope — they return {spotlights:[...]} / {spotlight:...}
 * directly (see app/api/admin/creator-spotlight/route.ts). apiClient's
 * response interceptor only unwraps bodies containing both `success` and
 * `data` keys, so these pass through unchanged — read `data.spotlights` /
 * `data.spotlight` directly, not `data.data.spotlights`.
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

interface Spotlight {
  id: string;
  creator_id: string;
  month_year: string;
  blurb: string | null;
  is_active: boolean;
  created_at: string;
  creator_username: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
  admin_username: string | null;
}

function formatMonthYear(my: string): string {
  const [year, month] = my.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function fetchSpotlights(): Promise<Spotlight[]> {
  const { data } = await apiClient.get<{ spotlights: Spotlight[] }>('/admin/creator-spotlight');
  return data?.spotlights ?? [];
}

function AdminCreatorSpotlightPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creatorId, setCreatorId] = useState('');
  const [monthYear, setMonthYear] = useState(currentMonthValue());
  const [blurb, setBlurb] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'creator-spotlight'], queryFn: fetchSpotlights });

  const createMutation = useMutation({
    mutationFn: () => apiClient.post('/admin/creator-spotlight', { creatorId: creatorId.trim(), monthYear, blurb: blurb.trim() || undefined }),
    onSuccess: () => {
      showToast(t('admin.creatorSpotlight.created', 'Spotlight created!'));
      setCreatorId('');
      setBlurb('');
      qc.invalidateQueries({ queryKey: ['admin', 'creator-spotlight'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? t('admin.creatorSpotlight.createFailed', 'Failed to create spotlight');
      showToast(msg, 'error');
    },
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.creatorSpotlight', 'Creator of the Month')}</h1>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        {t('admin.creatorSpotlight.subtitle', 'Highlight one creator per month on the Discover page.')}
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="mb-5 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
        <p className="mb-3 text-sm font-semibold text-neutral-900">{t('admin.creatorSpotlight.addNew', 'Add New Spotlight')}</p>
        <div className="space-y-3">
          <AdminField label={t('admin.creatorSpotlight.creatorId', 'Creator User ID (UUID)')}>
            <input
              type="text"
              value={creatorId}
              onChange={(e) => setCreatorId(e.target.value.trim())}
              placeholder={t('admin.creatorSpotlight.creatorIdPlaceholder', "Paste the user's UUID from the Users page")}
              className={adminInputClass}
            />
          </AdminField>
          <AdminField label={t('admin.creatorSpotlight.month', 'Month')}>
            <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.creatorSpotlight.blurb', 'Blurb (optional)')}>
            <input
              type="text"
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              maxLength={500}
              placeholder={t('admin.creatorSpotlight.blurbPlaceholder', 'Short promo text shown on the Discover page…')}
              className={adminInputClass}
            />
          </AdminField>
        </div>
        <button
          type="button"
          disabled={createMutation.isPending || !creatorId.trim()}
          onClick={() => createMutation.mutate()}
          className="mt-4 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {createMutation.isPending ? '…' : t('admin.creatorSpotlight.add', 'Add Spotlight')}
        </button>
      </div>

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (data?.length ?? 0) === 0 && (
          <AdminEmptyState icon="⭐" title={t('admin.creatorSpotlight.empty', 'No spotlights yet')} hint={t('admin.creatorSpotlight.emptyHint', 'Use the form above to add the first one.')} />
        )}
        {status === 'success' &&
          data?.map((s) => (
            <AdminCard key={s.id}>
              <div className="flex items-start gap-3">
                {s.creator_avatar_url ? (
                  <img src={s.creator_avatar_url} alt={s.creator_username ?? 'Creator'} className="h-10 w-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700">
                    {(s.creator_display_name ?? s.creator_username ?? '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900 truncate">{s.creator_display_name ?? s.creator_username ?? '—'}</p>
                    {s.is_active ? (
                      <AdminBadge label={t('admin.creatorSpotlight.current', 'Creator of the Month')} color="gold" />
                    ) : (
                      <AdminBadge label={t('admin.creatorSpotlight.past', 'Past')} color="neutral" />
                    )}
                  </div>
                  {s.creator_username && <p className="text-xs text-neutral-500">@{s.creator_username}</p>}
                  <p className="mt-1 text-[11px] text-neutral-400">{formatMonthYear(s.month_year)}</p>
                  {s.blurb && <p className="mt-1.5 text-xs text-neutral-600 line-clamp-2">{s.blurb}</p>}
                  <p className="mt-1.5 text-[10px] text-neutral-400">
                    {t('admin.creatorSpotlight.addedBy', 'Added by')} {s.admin_username ? `@${s.admin_username}` : '—'} · {fmtDate(s.created_at)}
                  </p>
                </div>
              </div>
            </AdminCard>
          ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/creator-spotlight')({
  component: AdminCreatorSpotlightPage,
});
