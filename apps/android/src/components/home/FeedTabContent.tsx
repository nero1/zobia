/**
 * apps/android/src/components/home/FeedTabContent.tsx
 *
 * Cursor-paginated feed list for one Home Feed tab. Unlike web's
 * button-based "Load more" (apps/web/components/home/FeedTabContent.tsx),
 * this app's own established pattern for cursor-paginated lists (see the
 * previous apps/android/src/routes/home.tsx) is `useInfiniteQuery` +
 * `IntersectionObserver` true infinite scroll — matched here rather than
 * importing web's button pattern. Ads (AdSlot) are interleaved every 6
 * items via placement "home_feed_native", same cadence as web.
 */

import { useCallback, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { FeedItemCard, FeedItemCardSkeleton } from './FeedItemCard';
import AdSlot from '@/components/ads/AdSlot';
import type { FeedPage, FeedTab } from '@/lib/feed/types';

const ADS_EVERY_N_ITEMS = 6;

async function fetchFeedPage(tab: FeedTab, cursor?: string): Promise<FeedPage> {
  const params = new URLSearchParams({ tab, limit: '20' });
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<FeedPage>(`/feed?${params.toString()}`);
  return data ?? { items: [], nextCursor: null };
}

export function FeedTabContent({ tab }: { tab: FeedTab }) {
  const { t } = useTranslation();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['home', 'feed', tab],
    queryFn: ({ pageParam }) => fetchFeedPage(tab, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const observer = useRef<IntersectionObserver | null>(null);
  const loaderRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observer.current) observer.current.disconnect();
      if (node) {
        observer.current = new IntersectionObserver((entries) => {
          if (entries[0]?.isIntersecting && hasNextPage) {
            fetchNextPage();
          }
        });
        observer.current.observe(node);
      }
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage]
  );

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (status === 'pending') {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <FeedItemCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/30 px-4 py-8 text-center">
        <p className="text-sm text-red-700 dark:text-red-300">{t('feedTabs.loadError')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white"
        >
          {t('android.error.retry')}
        </button>
      </div>
    );
  }

  if (items.length === 0 && !isRefetching) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 p-10 text-center">
        <div className="mb-2 text-3xl">🗂️</div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('feedTabs.empty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={`${item.contentType}:${item.contentId}:${i}`} className="space-y-3">
          <FeedItemCard item={item} />
          {(i + 1) % ADS_EVERY_N_ITEMS === 0 && <AdSlot placement="home_feed_native" />}
        </div>
      ))}
      <div ref={loaderRef} className="py-4">
        {isFetchingNextPage && (
          <div className="flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  );
}
