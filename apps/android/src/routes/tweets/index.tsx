/**
 * apps/android/src/routes/tweets/index.tsx
 *
 * Tweets feed — mirrors apps/web/app/(app)/tweets/page.tsx, adapted to this
 * app's infinite-scroll convention (see routes/home.tsx).
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useRef, useCallback, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { PullToRefresh } from '@/components/ui/PullToRefresh';
import { TweetCard } from '@/components/tweets/TweetCard';
import { mapTweet, type TweetRow } from '@/components/tweets/types';

type TabKey = 'foryou' | 'friends' | 'following' | 'mentions';
const TABS: TabKey[] = ['foryou', 'friends', 'following', 'mentions'];

function TweetSkeleton() {
  return (
    <div className="bg-white border-b border-neutral-100 p-4 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-neutral-200" />
        <div className="flex-1">
          <div className="h-4 bg-neutral-200 rounded w-24 mb-1" />
          <div className="h-3 bg-neutral-100 rounded w-16" />
        </div>
      </div>
      <div className="h-4 bg-neutral-200 rounded w-full mb-2" />
      <div className="h-4 bg-neutral-100 rounded w-3/4" />
    </div>
  );
}

function TweetsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('foryou');

  const fetchTweetsPage = useCallback(
    async ({ pageParam }: { pageParam?: string }) => {
      const params = new URLSearchParams({ tab, limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      const { data } = await apiClient.get<{ tweets: TweetRow[]; nextCursor: string | null }>(`/tweets?${params}`);
      return { items: (data?.tweets ?? []).map(mapTweet), nextCursor: data?.nextCursor ?? null };
    },
    [tab]
  );

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status, refetch } = useInfiniteQuery({
    queryKey: ['tweets', 'feed', tab],
    queryFn: fetchTweetsPage,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const toggleLike = useMutation({
    mutationFn: ({ tweetId, liked }: { tweetId: string; liked: boolean }) =>
      apiClient[liked ? 'delete' : 'post'](`/tweets/${tweetId}/like`),
    onMutate: ({ tweetId, liked }) => {
      qc.setQueryData<typeof data>(['tweets', 'feed', tab], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((tw) =>
              tw.id === tweetId ? { ...tw, liked: !liked, likesCount: tw.likesCount + (liked ? -1 : 1) } : tw
            ),
          })),
        };
      });
    },
  });

  const handleToggleLike = useCallback(
    (tweetId: string, liked: boolean) => toggleLike.mutate({ tweetId, liked }),
    [toggleLike]
  );

  const toggleRetweet = useMutation({
    mutationFn: ({ tweetId, retweeted, quoteContent }: { tweetId: string; retweeted: boolean; quoteContent?: string }) =>
      retweeted ? apiClient.delete(`/tweets/${tweetId}/retweet`) : apiClient.post(`/tweets/${tweetId}/retweet`, quoteContent ? { quoteContent } : {}),
    onMutate: ({ tweetId, retweeted }) => {
      qc.setQueryData<typeof data>(['tweets', 'feed', tab], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((tw) =>
              tw.id === tweetId ? { ...tw, retweeted: !retweeted, retweetsCount: tw.retweetsCount + (retweeted ? -1 : 1) } : tw
            ),
          })),
        };
      });
    },
  });

  const handleToggleRetweet = useCallback(
    (tweetId: string, retweeted: boolean, quoteContent?: string) => toggleRetweet.mutate({ tweetId, retweeted, quoteContent }),
    [toggleRetweet]
  );

  const observer = useRef<IntersectionObserver | null>(null);
  const loaderRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observer.current) observer.current.disconnect();
      if (node) {
        observer.current = new IntersectionObserver((entries) => {
          if (entries[0]?.isIntersecting && hasNextPage) fetchNextPage();
        });
        observer.current.observe(node);
      }
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage]
  );

  const tweets = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <PullToRefresh onRefresh={() => refetch()} className="h-full overflow-y-auto bg-neutral-50">
      <div className="bg-white border-b border-neutral-100">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-neutral-900">{t('tweets.title')}</h1>
            <p className="text-xs text-neutral-500">{t('tweets.subtitle')}</p>
          </div>
          <Link to="/tweets/create" className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
            + {t('tweets.compose')}
          </Link>
        </div>
        <div className="flex gap-1 overflow-x-auto px-2 pb-2">
          {TABS.map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ${
                tab === tabKey ? 'bg-primary-600 text-white' : 'text-neutral-600 bg-neutral-100'
              }`}
            >
              {t(`tweets.tabs.${tabKey}`)}
            </button>
          ))}
        </div>
      </div>

      {status === 'pending' && <div>{Array.from({ length: 4 }).map((_, i) => <TweetSkeleton key={i} />)}</div>}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
            {t('android.error.retry')}
          </button>
        </div>
      )}

      {status === 'success' && tweets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-3xl">🐦</div>
          <p className="font-semibold text-neutral-900 text-sm">{t(`tweets.empty.${tab}`)}</p>
          <Link to="/tweets/create" className="mt-4 rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white">
            {t('tweets.compose')}
          </Link>
        </div>
      )}

      {tweets.map((tw) => (
        <TweetCard key={tw.id} tweet={tw} onToggleLike={handleToggleLike} onToggleRetweet={handleToggleRetweet} />
      ))}

      <div ref={loaderRef} className="py-4">
        {isFetchingNextPage && (
          <div className="flex justify-center">
            <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}

export const Route = createFileRoute('/tweets/')({
  component: TweetsPage,
});
