/**
 * apps/android/src/routes/market/index.tsx
 *
 * Market home — mirrors apps/web/app/(app)/market/page.tsx: Sponsored,
 * Featured, Trending (creator items), and Platform Store sections, each
 * capped for a grid preview with a "View more" link to /market/$section.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { MarketItemCard, type MarketItem } from '@/components/market/MarketItemCard';

interface MarketHome {
  sponsored: MarketItem[];
  featured: MarketItem[];
  trending: MarketItem[];
  platform: MarketItem[];
}

async function fetchHome(): Promise<MarketHome> {
  const { data } = await apiClient.get<{ data: MarketHome }>('/market');
  return data.data ?? { sponsored: [], featured: [], trending: [], platform: [] };
}

function Section({ title, items, section, view }: { title: string; items: MarketItem[]; section: string; view: 'grid' | 'list' }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-neutral-900">{title}</h2>
        <Link to="/market/$section" params={{ section }} className="text-xs font-medium text-primary-600">View more →</Link>
      </div>
      <div className={view === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
        {items.map((item) => <MarketItemCard key={`${item.kind}:${item.id}`} item={item} view={view} />)}
      </div>
    </section>
  );
}

function MarketHomePage() {
  const { t } = useTranslation();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const { data: home, status } = useQuery({ queryKey: ['market', 'home'], queryFn: fetchHome });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-5 px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{t('market.title', '🏪 Market')}</h1>
          <p className="mt-0.5 text-xs text-neutral-500">{t('market.subtitle', 'Credits, cosmetics, boosts, and creator items — all in one place.')}</p>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5">
          <button onClick={() => setView('list')} className={`rounded-md px-2 py-1 text-xs font-medium ${view === 'list' ? 'bg-primary-600 text-white' : 'text-neutral-500'}`}>☰</button>
          <button onClick={() => setView('grid')} className={`rounded-md px-2 py-1 text-xs font-medium ${view === 'grid' ? 'bg-primary-600 text-white' : 'text-neutral-500'}`}>⊞</button>
        </div>
      </div>

      {status === 'pending' || !home ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-neutral-200" />)}
        </div>
      ) : (
        <>
          <Section title={t('market.sponsored', '🚀 Sponsored')} items={home.sponsored} section="sponsored" view={view} />
          <Section title={t('market.featured', '⭐ Featured')} items={home.featured} section="featured" view={view} />
          <Section title={t('market.trending', '🔥 Trending from Creators')} items={home.trending} section="trending" view={view} />
          <Section title={t('market.platform', '🛒 Platform Store')} items={home.platform} section="platform" view={view} />
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/market/')({
  component: MarketHomePage,
});
