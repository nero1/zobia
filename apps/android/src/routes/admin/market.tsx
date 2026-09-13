/**
 * apps/android/src/routes/admin/market.tsx
 *
 * Market Curation — mirrors apps/web/app/(admin)/gate44/market/page.tsx:
 * search creator marketplace items and platform store items, toggle
 * Featured/Sponsored flags backing the Market page's Sponsored/Featured
 * sections (lib/market/query.ts).
 *
 * GET  /admin/market?q=            -> { products }
 * PATCH /admin/market/:id          { isAdminFeatured? | isSponsored? }
 * GET  /admin/store-items?q=       -> { items }
 * PATCH /admin/store-items/:id     { isFeatured }
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
  AdminToggle,
  AdminTabs,
  adminInputClass,
} from '@/components/admin/AdminUI';

type Tab = 'creator' | 'platform';

interface AdminProduct {
  id: string;
  name: string;
  product_type: string;
  price_kobo: string;
  is_active: boolean;
  is_sponsored: boolean;
  is_admin_featured: boolean;
  sponsored_until: string | null;
  creator_username: string;
}

interface AdminStoreItem {
  id: string;
  name: string;
  item_type: string;
  cosmetic_type: string | null;
  is_active: boolean;
  is_featured: boolean;
}

async function fetchProducts(q: string): Promise<AdminProduct[]> {
  const { data } = await apiClient.get<{ products: AdminProduct[] }>(`/admin/market?q=${encodeURIComponent(q)}`);
  return data?.products ?? [];
}

async function fetchStoreItems(q: string): Promise<AdminStoreItem[]> {
  const { data } = await apiClient.get<{ items: AdminStoreItem[] }>(`/admin/store-items?q=${encodeURIComponent(q)}`);
  return data?.items ?? [];
}

function AdminMarketPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('creator');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: products, status: productsStatus } = useQuery({
    queryKey: ['admin', 'market', 'products', debounced],
    queryFn: () => fetchProducts(debounced),
    enabled: tab === 'creator',
  });
  const { data: items, status: itemsStatus } = useQuery({
    queryKey: ['admin', 'market', 'store-items', debounced],
    queryFn: () => fetchStoreItems(debounced),
    enabled: tab === 'platform',
  });

  const patchProduct = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: 'isAdminFeatured' | 'isSponsored'; value: boolean }) =>
      apiClient.patch(`/admin/market/${id}`, { [field]: value }),
    onSuccess: () => {
      notify(t('admin.saved', 'Updated'));
      qc.invalidateQueries({ queryKey: ['admin', 'market', 'products'] });
    },
    onError: () => notify(t('admin.saveFailed', 'Failed to update'), 'error'),
  });

  const patchItem = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => apiClient.patch(`/admin/store-items/${id}`, { isFeatured: value }),
    onSuccess: () => {
      notify(t('admin.saved', 'Updated'));
      qc.invalidateQueries({ queryKey: ['admin', 'market', 'store-items'] });
    },
    onError: () => notify(t('admin.saveFailed', 'Failed to update'), 'error'),
  });

  const tabs = [
    { key: 'creator' as const, label: t('admin.market.tabCreator', 'Creator Items') },
    { key: 'platform' as const, label: t('admin.market.tabPlatform', 'Platform Items') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.nav.market', 'Market Curation')}</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">{t('admin.market.subtitle', 'Feature or sponsor items shown on the Market page.')}</p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      <form onSubmit={(e) => { e.preventDefault(); setDebounced(query); }} className="mb-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.market.searchPlaceholder', 'Search by name or creator username…')}
          className={adminInputClass}
        />
        <button type="submit" className="shrink-0 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white">
          {t('nav.search', 'Search')}
        </button>
      </form>

      {tab === 'creator' && (
        <div className="space-y-2.5">
          {productsStatus === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
          {productsStatus === 'error' && <AdminErrorState onRetry={() => qc.invalidateQueries({ queryKey: ['admin', 'market', 'products'] })} />}
          {productsStatus === 'success' && (products?.length ?? 0) === 0 && (
            <AdminEmptyState icon="🛒" title={t('admin.market.noItems', 'No items found')} />
          )}
          {productsStatus === 'success' &&
            products?.map((p) => (
              <AdminCard key={p.id}>
                <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{p.name}</p>
                <p className="mb-2.5 text-xs text-neutral-500 dark:text-neutral-400">@{p.creator_username} · {p.product_type}</p>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('admin.market.featured', 'Featured')}</span>
                    <AdminToggle
                      checked={p.is_admin_featured}
                      disabled={patchProduct.isPending}
                      onChange={(v) => patchProduct.mutate({ id: p.id, field: 'isAdminFeatured', value: v })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('admin.market.sponsored', 'Sponsored')}</span>
                    <AdminToggle
                      checked={p.is_sponsored}
                      disabled={patchProduct.isPending}
                      onChange={(v) => patchProduct.mutate({ id: p.id, field: 'isSponsored', value: v })}
                    />
                  </div>
                </div>
              </AdminCard>
            ))}
        </div>
      )}

      {tab === 'platform' && (
        <div className="space-y-2.5">
          {itemsStatus === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
          {itemsStatus === 'error' && <AdminErrorState onRetry={() => qc.invalidateQueries({ queryKey: ['admin', 'market', 'store-items'] })} />}
          {itemsStatus === 'success' && (items?.length ?? 0) === 0 && (
            <AdminEmptyState icon="🏪" title={t('admin.market.noItems', 'No items found')} />
          )}
          {itemsStatus === 'success' &&
            items?.map((i) => (
              <AdminCard key={i.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{i.name}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{i.item_type}{i.cosmetic_type ? ` · ${i.cosmetic_type}` : ''}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t('admin.market.featured', 'Featured')}</span>
                    <AdminToggle checked={i.is_featured} disabled={patchItem.isPending} onChange={(v) => patchItem.mutate({ id: i.id, value: v })} />
                  </div>
                </div>
              </AdminCard>
            ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/market')({
  component: AdminMarketPage,
});
