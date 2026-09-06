/**
 * apps/android/src/routes/merch/index.tsx
 *
 * Merch directory — mirrors apps/web/app/(app)/merch/page.tsx: grid of
 * active creator merch stores, links to /merch/$creatorId.
 *
 * CONTRACT FIX (see report): the web page called GET /api/merch/stores,
 * which doesn't exist — the real listing endpoint is GET /api/merch (fixed
 * in the same commit, apps/web/app/(app)/merch/page.tsx). That endpoint also
 * doesn't join creator username/avatar, so — unlike the pre-existing (and
 * also broken) web page's assumption — this card shows only store name/
 * description/product count.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess } from '@/lib/hooks/useManifest';
import { FeatureNotFound } from '@/components/shared/FeatureNotFound';

interface MerchStore {
  creatorId: string;
  storeName: string;
  description: string | null;
  productCount: number;
}

async function fetchStores(): Promise<MerchStore[]> {
  const { data } = await apiClient.get<{ stores: Array<{ storeId: string; creatorId: string; name: string; description: string | null; products: unknown[] }> }>('/merch');
  return (data?.stores ?? []).map((r) => ({
    creatorId: r.creatorId,
    storeName: r.name,
    description: r.description,
    productCount: r.products.length,
  }));
}

function MerchDirectoryPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();
  const access = resolveFeatureAccess(
    featureFlags?.merchStore !== false,
    modVisibleKeys.includes('merchStore'),
    { isAdmin: user?.is_admin, isModerator: user?.is_moderator }
  );
  const [search, setSearch] = useState('');
  const { data: stores, status } = useQuery({ queryKey: ['merch', 'stores'], queryFn: fetchStores, enabled: access.accessible });

  const filtered = (stores ?? []).filter((s) => s.storeName.toLowerCase().includes(search.toLowerCase()));

  if (!access.accessible) {
    return <FeatureNotFound />;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">{t('merch.title', 'Merch Stores')}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">{t('merch.subtitle', 'Shop merchandise from your favourite creators.')}</p>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('merch.searchPlaceholder', 'Search stores…')}
        className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
      />

      {status === 'pending' ? (
        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-neutral-200" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-neutral-200 bg-white py-16">
          <span className="text-5xl">🛍️</span>
          <p className="mt-3 font-semibold text-neutral-700">{search ? t('merch.noSearchResults', 'No stores match your search') : t('merch.empty', 'No stores yet')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((store) => (
            <Link
              key={store.creatorId}
              to="/merch/$creatorId"
              params={{ creatorId: store.creatorId }}
              className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-2 flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl">🛍️</span>
                <p className="min-w-0 truncate font-semibold text-neutral-900">{store.storeName}</p>
              </div>
              {store.description && <p className="mb-2 line-clamp-2 text-sm text-neutral-600">{store.description}</p>}
              <span className="text-xs text-neutral-500">{t('merch.productCount', '{{count}} products', { count: store.productCount })}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/merch/')({
  component: MerchDirectoryPage,
});
