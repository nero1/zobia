/**
 * apps/android/src/routes/blogs/index.tsx
 *
 * Blogs discovery — mirrors apps/web/app/(app)/blogs/page.tsx's search +
 * card grid. The fuller tab UI (Popular/Trending/New/Random) stays
 * web/PWA-only, same convention as the Games list on this app. The
 * "Subscribed" view is the one exception — surfaced as a simple toggle
 * rather than a full tab bar, since it's a common return-visit action.
 */

import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { PostDiscovery } from '@/components/blogs/PostDiscovery';
import { Icon } from '@/components/ui/Icon';

interface BlogSummary {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  subscriber_count: number;
  show_subscriber_count: boolean;
  post_count: number;
  owner_username: string | null;
}

type Tab = 'popular'|'trending'|'new'|'random'|'subscribed';
async function fetchBlogs(q: string, tab: Tab, cursor: string | null) {
  const params = new URLSearchParams({ tab, limit: '6' });
  if (q.trim()) params.set('q', q.trim());
  if (cursor) params.set('cursor',cursor);
  const { data } = await apiClient.get<{ blogs: BlogSummary[]; nextCursor: string | null }>(`/blogs?${params}`);
  return data;
}

async function fetchMyBlog() {
  const { data } = await apiClient.get<{ blog: { slug: string } | null }>('/blogs/me');
  return data?.blog ?? null;
}

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-card animate-pulse">
      <div className="w-full h-20 rounded-xl bg-neutral-200 dark:bg-neutral-700 mb-3" />
      <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-3/4 mb-2" />
      <div className="h-3 bg-neutral-100 dark:bg-neutral-800 rounded w-1/2" />
    </div>
  );
}

function BlogsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('popular');
  const subscribedOnly = tab === 'subscribed';

  const discovery = useInfiniteQuery({
    queryKey: ['blogs',search,tab], initialPageParam: null as string|null,
    queryFn: ({pageParam})=>fetchBlogs(search,tab,pageParam),
    getNextPageParam: (page)=>page.nextCursor ?? undefined,
    staleTime: 5 * 60_000,
  });
  const status = discovery.status;
  const blogs = discovery.data?.pages.flatMap((p)=>p.blogs).filter((b,i,all)=>all.findIndex((x)=>x.id===b.id)===i) ?? [];

  const { data: myBlog } = useQuery({ queryKey: ['blogs', 'me'], queryFn: fetchMyBlog, staleTime: 60_000 });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 px-4 py-4">
      <div className="mb-3 flex justify-between items-center">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{t('blogs.title', 'Blogs')}</h1>
        <Link
          to={myBlog ? '/blogs/$slug' : '/blogs/new'}
          params={myBlog ? { slug: myBlog.slug } : undefined}
          className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300"
        >
          {myBlog ? t('blogs.myDashboard', 'My Blog') : t('blogs.startBlog', 'Start a Blog')}
        </Link>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('blogs.search.placeholder', 'Search blogs…')}
        className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 mb-3 focus:border-primary-500 focus:outline-none"
      />

      <div className="flex gap-2 overflow-x-auto mb-4">{(['popular','trending','new','random','subscribed'] as Tab[]).map((item)=><button key={item} type="button" aria-pressed={tab===item} onClick={()=>setTab(item)} className={`rounded-full px-3 py-2 text-sm ${tab===item?'bg-primary-600 text-white':'bg-white text-neutral-800 border'}`}>{t(`blogs.tab.${item}`,item.charAt(0).toUpperCase()+item.slice(1))}</button>)}</div>

      {status === 'pending' && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {status === 'success' && blogs.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <p className="text-neutral-500 dark:text-neutral-400 text-sm">
            {subscribedOnly
              ? t('blogs.subscribed.empty', "You haven't subscribed to any blogs yet.")
              : t('blogs.empty', 'No blogs yet — be the first to start one.')}
          </p>
        </div>
      )}

      {status === 'success' && blogs.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {blogs.map((b) => (
            <Link key={b.id} to="/blogs/$slug" params={{ slug: b.slug }} className="block bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-card active:scale-95 transition-transform">
              <div className="flex items-center justify-center h-16 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-3xl mb-2"><Icon emoji="📝" size={32} /></div>
              <p className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm truncate">{b.title}</p>
              {b.tagline && <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-0.5 truncate">{b.tagline}</p>}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-neutral-400 dark:text-neutral-500">{b.post_count} posts</span>
                {b.show_subscriber_count && <span className="text-xs text-emerald-600">{b.subscriber_count} subs</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
      {discovery.isError && <p role="alert">{t('blogs.error','Unable to load blogs.')} <button type="button" onClick={()=>void discovery.refetch()}>{t('common.retry','Retry')}</button></p>}
      {discovery.hasNextPage && <button type="button" disabled={discovery.isFetchingNextPage} onClick={()=>void discovery.fetchNextPage()} className="block mx-auto mt-4 border rounded-full px-5 py-2">{discovery.isFetchingNextPage?t('blogs.loading','Loading…'):t('blogs.loadMore','Load more')}</button>}
      <PostDiscovery search={search} />
    </div>
  );
}

export const Route = createFileRoute('/blogs/')({
  component: BlogsPage,
});
