/**
 * apps/android/src/routes/home.tsx
 *
 * Social feed — infinite scroll with cursor pagination.
 * Query key: ['home', 'feed']. Endpoint: GET /api/home/feed.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useRef, useCallback } from 'react';
import { apiClient } from '@/lib/api/client';
import type { PaginatedResponse } from '@zobia/shared/types';

interface FeedPost {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  content: string;
  createdAt: string;
}

async function fetchFeed({ pageParam }: { pageParam?: string }) {
  const params = new URLSearchParams({ limit: '20' });
  if (pageParam) params.set('cursor', pageParam);
  const { data } = await apiClient.get<PaginatedResponse<FeedPost>>(`/home/feed?${params}`);
  return data;
}

function SkeletonCard() {
  return (
    <div className="bg-white border-b border-neutral-100 p-4 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-neutral-200" />
        <div className="flex-1">
          <div className="h-4 bg-neutral-200 rounded w-24 mb-1" />
          <div className="h-3 bg-neutral-100 rounded w-16" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-4 bg-neutral-200 rounded w-full" />
        <div className="h-4 bg-neutral-200 rounded w-3/4" />
      </div>
    </div>
  );
}

function PostCard({ post }: { post: FeedPost }) {
  const date = new Date(post.createdAt);
  const timeAgo = formatTimeAgo(date);

  return (
    <article className="bg-white border-b border-neutral-100 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-lg">
          {post.avatarEmoji || '👤'}
        </div>
        <div>
          <p className="font-semibold text-neutral-900 text-sm">{post.displayName}</p>
          <p className="text-neutral-400 text-xs">@{post.username} · {timeAgo}</p>
        </div>
      </div>
      <p className="text-neutral-800 text-sm leading-relaxed">{post.content}</p>
    </article>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function HomePage() {
  const { t } = useTranslation();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['home', 'feed'],
    queryFn: fetchFeed,
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

  const posts = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      {status === 'pending' && (
        <div>
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm"
          >
            {t('android.error.retry')}
          </button>
        </div>
      )}

      {status === 'success' && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-neutral-500 text-sm">{t('home.feed.empty')}</p>
        </div>
      )}

      {posts.map((post) => <PostCard key={post.id} post={post} />)}

      {/* Infinite scroll sentinel */}
      <div ref={loaderRef} className="py-4">
        {isFetchingNextPage && (
          <div className="flex justify-center">
            <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/home')({
  component: HomePage,
});
