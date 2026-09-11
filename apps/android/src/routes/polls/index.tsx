/**
 * apps/android/src/routes/polls/index.tsx
 *
 * Polls list — mirrors apps/web/app/(app)/polls/page.tsx as closely as
 * possible for UI parity (same "always mirror mobile web/PWA" requirement
 * as Answers). Uses this app's infinite-scroll convention instead of a
 * manual "Load more" button.
 *
 * GET /api/polls — cursor-paginated, tab-filtered.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useCallback, useRef, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { useFeatureFlags } from '@/lib/hooks/useManifest';

type Tab = 'new' | 'popular' | 'mine';

interface PollSummary {
  id: string;
  slug: string;
  title: string;
  voterCount: number;
  createdAt: string;
  creatorUsername: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function fetchPollsPage({ pageParam, tab }: { pageParam?: string; tab: Tab }) {
  const params = new URLSearchParams({ tab, limit: '20' });
  if (pageParam) params.set('cursor', pageParam);
  const { data } = await apiClient.get<{ polls: PollSummary[]; nextCursor: string | null }>(`/polls?${params}`);
  return { items: data?.polls ?? [], nextCursor: data?.nextCursor ?? null };
}

function PollCard({ p }: { p: PollSummary }) {
  const { t } = useTranslation();
  return (
    <Link to="/polls/$slug" params={{ slug: p.slug }} className="block bg-white border-b border-neutral-100 p-4">
      <h3 className="line-clamp-2 text-sm font-semibold text-neutral-900">{p.title}</h3>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span>@{p.creatorUsername ?? 'unknown'}</span>
        <span>·</span>
        <span>{timeAgo(p.createdAt)}</span>
        <span>·</span>
        <span>{p.voterCount} {p.voterCount === 1 ? t('polls.voter', 'voter') : t('polls.voters', 'voters')}</span>
      </div>
    </Link>
  );
}

function PollsPage() {
  const { t } = useTranslation();
  const featureFlags = useFeatureFlags();
  const [tab, setTab] = useState<Tab>('new');

  const queryKey = ['polls', 'list', tab];
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status, refetch } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPollsPage({ pageParam, tab }),
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
          if (entries[0]?.isIntersecting && hasNextPage) fetchNextPage();
        });
        observer.current.observe(node);
      }
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage],
  );

  const polls = data?.pages.flatMap((p) => p.items) ?? [];

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'new', label: t('polls.tabs.new', 'New'), icon: '🆕' },
    { key: 'popular', label: t('polls.tabs.popular', 'Popular'), icon: '🔥' },
    { key: 'mine', label: t('polls.tabs.mine', 'Mine'), icon: '👤' },
  ];

  if (featureFlags && featureFlags.polls === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-neutral-50 px-6 text-center">
        <p className="text-sm text-neutral-500">{t('polls.disabled', 'Polls are currently unavailable.')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="flex items-center justify-between bg-white px-4 py-3 border-b border-neutral-100">
        <h1 className="text-lg font-bold text-neutral-900">{t('polls.title', 'Polls')}</h1>
        <Link to="/polls/new" className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
          + {t('polls.create.cta', 'Create Poll')}
        </Link>
      </div>

      <div className="flex gap-1 bg-white px-3 py-2 border-b border-neutral-100">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${tab === key ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {status === 'pending' && (
        <div>{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 border-b border-neutral-100 bg-white p-4 animate-pulse" />)}</div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">{t('android.error.retry')}</button>
        </div>
      )}

      {status === 'success' && polls.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-3xl">📊</div>
          <p className="font-semibold text-neutral-900 text-sm">
            {tab === 'mine' ? t('polls.empty.mine', "You haven't created any polls yet") : t('polls.empty.default', 'No polls yet')}
          </p>
        </div>
      )}

      {polls.map((p) => <PollCard key={p.id} p={p} />)}

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

export const Route = createFileRoute('/polls/')({
  component: PollsPage,
});
