/**
 * apps/android/src/routes/admin/profile-themes.tsx
 *
 * Profile Themes catalog admin — mirrors apps/web/app/(admin)/gate44/profile-themes/page.tsx:
 * toggle enabled, plan/business-tier gating chips, and credits/stars price
 * per theme (for themes that have a linked store item).
 *
 * GET   /admin/profile-themes       -> { themes }
 * PATCH /admin/profile-themes/:id   { enabled? | includedForPlans? | includedForBusinessTiers? | creditsCost? | starsCost? }
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
  AdminToggle,
  adminInputClass,
} from '@/components/admin/AdminUI';

interface ThemeRow {
  id: string;
  name: string;
  description: string | null;
  is_free_default: boolean;
  included_for_plans: string[];
  included_for_business_tiers: string[];
  credits_cost: number | null;
  stars_cost: number | null;
  enabled: boolean;
  store_item_id: string | null;
}

const PLANS = ['free', 'plus', 'pro', 'max'] as const;
const BUSINESS_TIERS = ['starter', 'growth', 'enterprise'] as const;

async function fetchThemes(): Promise<ThemeRow[]> {
  const { data } = await apiClient.get<{ themes: ThemeRow[] }>('/admin/profile-themes');
  return data?.themes ?? [];
}

function AdminProfileThemesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: themes, status, refetch } = useQuery({ queryKey: ['admin', 'profile-themes'], queryFn: fetchThemes });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiClient.patch(`/admin/profile-themes/${id}`, body),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: () => {
      notify(t('admin.saved', 'Saved'));
      qc.invalidateQueries({ queryKey: ['admin', 'profile-themes'] });
    },
    onError: () => notify(t('admin.saveFailed', 'Update failed'), 'error'),
    onSettled: () => setBusyId(null),
  });

  const toggleTier = (theme: ThemeRow, kind: 'plan' | 'tier', value: string) => {
    if (kind === 'plan') {
      const next = theme.included_for_plans.includes(value)
        ? theme.included_for_plans.filter((p) => p !== value)
        : [...theme.included_for_plans, value];
      patch.mutate({ id: theme.id, body: { includedForPlans: next } });
    } else {
      const next = theme.included_for_business_tiers.includes(value)
        ? theme.included_for_business_tiers.filter((p) => p !== value)
        : [...theme.included_for_business_tiers, value];
      patch.mutate({ id: theme.id, body: { includedForBusinessTiers: next } });
    }
  };

  return (
    <div className="px-4 py-5">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.nav.profileThemes', 'Profile Themes')}</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        {t('admin.profileThemes.subtitle', 'One free-default theme is always available. Everything else is gated by plan/business tier, or purchasable with credits/stars.')}
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="space-y-3">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (themes?.length ?? 0) === 0 && <AdminEmptyState icon="🎨" title={t('admin.profileThemes.empty', 'No themes')} />}
        {status === 'success' &&
          themes?.map((th) => {
            const isBusy = busyId === th.id;
            return (
              <AdminCard key={th.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">{th.name}</p>
                      {th.is_free_default && <AdminBadge label={t('admin.profileThemes.freeDefault', 'Free default')} color="teal" />}
                    </div>
                    {th.description && <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{th.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('admin.profileThemes.enabled', 'Enabled')}</span>
                    <AdminToggle checked={th.enabled} disabled={isBusy} onChange={(v) => patch.mutate({ id: th.id, body: { enabled: v } })} />
                  </div>
                </div>

                {!th.is_free_default && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('admin.profileThemes.freeForPlans', 'Free for plans')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {PLANS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            disabled={isBusy}
                            onClick={() => toggleTier(th, 'plan', p)}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${th.included_for_plans.includes(p) ? 'bg-primary-600 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'}`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('admin.profileThemes.freeForTiers', 'Free for business tiers')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {BUSINESS_TIERS.map((tier) => (
                          <button
                            key={tier}
                            type="button"
                            disabled={isBusy}
                            onClick={() => toggleTier(th, 'tier', tier)}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${th.included_for_business_tiers.includes(tier) ? 'bg-primary-600 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'}`}
                          >
                            {tier}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase text-neutral-500 dark:text-neutral-400">{t('admin.profileThemes.priceForOthers', 'Price for everyone else')}</p>
                      {!th.store_item_id ? (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('admin.profileThemes.notPurchasable', 'Not purchasable (no linked store item).')}</p>
                      ) : (
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                            {t('admin.profileThemes.credits', 'Credits')}
                            <input
                              type="number"
                              min={0}
                              defaultValue={th.credits_cost ?? ''}
                              disabled={isBusy}
                              onBlur={(e) => patch.mutate({ id: th.id, body: { creditsCost: e.target.value === '' ? null : parseInt(e.target.value, 10) } })}
                              className={`${adminInputClass} w-20 py-1.5`}
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                            {t('admin.profileThemes.stars', 'Stars')}
                            <input
                              type="number"
                              min={0}
                              defaultValue={th.stars_cost ?? ''}
                              disabled={isBusy}
                              onBlur={(e) => patch.mutate({ id: th.id, body: { starsCost: e.target.value === '' ? null : parseInt(e.target.value, 10) } })}
                              className={`${adminInputClass} w-20 py-1.5`}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </AdminCard>
            );
          })}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/profile-themes')({
  component: AdminProfileThemesPage,
});
