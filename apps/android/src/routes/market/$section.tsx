/**
 * apps/android/src/routes/market/$section.tsx
 *
 * "View more" — full, paginated listing for one Market section, mirrors
 * apps/web/app/(app)/market/[section]/page.tsx.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { MarketItemCard, type MarketItem, type MarketCategory } from '@/components/market/MarketItemCard';

type MarketSort = 'price' | 'popularity' | 'rating';
const PAGE_SIZE = 24;

const SECTION_TITLE: Record<string, string> = {
  sponsored: '🚀 Sponsored',
  featured: '⭐ Featured',
  trending: '🔥 Trending from Creators',
  platform: '🛒 Platform Store',
};

const CATEGORIES: { value: MarketCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'digital', label: 'Digital' },
  { value: 'physical', label: 'Physical' },
  { value: 'cosmetics_themes', label: 'Cosmetics & Themes' },
  { value: 'boosts_passes', label: 'Boosts & Passes' },
  { value: 'credits', label: 'Credits' },
];

async function fetchSection(section: string, category: string, sort: MarketSort, offset: number): Promise<MarketItem[]> {
  const params = new URLSearchParams({ section, sort, limit: String(PAGE_SIZE), offset: String(offset) });
  if (category !== 'all') params.set('category', category);
  const { data } = await apiClient.get<{ data: { items: MarketItem[] } }>(`/market/section?${params.toString()}`);
  return data.data?.items ?? [];
}

function MarketSectionPage() {
  const { section } = Route.useParams();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [category, setCategory] = useState<MarketCategory | 'all'>('all');
  const [sort, setSort] = useState<MarketSort>('popularity');
  const isCreatorSortable = section === 'trending' || category === 'digital' || category === 'physical';

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } = useInfiniteQuery({
    queryKey: ['market', 'section', section, category, sort],
    queryFn: ({ pageParam }) => fetchSection(section, category, sort, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined),
  });

  const items = data?.pages.flat() ?? [];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/market" className="text-xs text-neutral-500">← Market</Link>
          <h1 className="text-lg font-bold text-neutral-900">{SECTION_TITLE[section] ?? section}</h1>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5">
          <button onClick={() => setView('list')} className={`rounded-md px-2 py-1 text-xs font-medium ${view === 'list' ? 'bg-primary-600 text-white' : 'text-neutral-500'}`}>☰</button>
          <button onClick={() => setView('grid')} className={`rounded-md px-2 py-1 text-xs font-medium ${view === 'grid' ? 'bg-primary-600 text-white' : 'text-neutral-500'}`}>⊞</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${category === c.value ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-200 text-neutral-600'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isCreatorSortable && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-neutral-500">Sort:</span>
          {(['popularity', 'price', 'rating'] as MarketSort[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sort === s ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}
            >
              {s === 'popularity' ? 'Popular' : s === 'price' ? 'Price' : 'Rating'}
            </button>
          ))}
        </div>
      )}

      {status === 'pending' ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-neutral-200" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">Nothing here yet.</p>
      ) : (
        <>
          <div className={view === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
            {items.map((item) => <MarketItemCard key={`${item.kind}:${item.id}`} item={item} view={view} />)}
          </div>
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-xl border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-60"
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/market/$section')({
  component: MarketSectionPage,
});
