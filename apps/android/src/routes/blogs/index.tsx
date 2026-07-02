/**
 * apps/android/src/routes/blogs/index.tsx
 *
 * Blogs discovery — mirrors apps/web/app/(app)/blogs/page.tsx's search +
 * card grid. The fuller tab UI (Popular/Trending/New/Random) stays
 * web/PWA-only, same convention as the Games list on this app.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

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

async function fetchBlogs(q: string) {
  const params = new URLSearchParams({ tab: 'popular' });
  if (q.trim()) params.set('q', q.trim());
  const { data } = await apiClient.get<{ data: { blogs: BlogSummary[] } }>(`/blogs?${params.toString()}`);
  return data?.data?.blogs ?? [];
}

async function fetchMyBlog() {
  const { data } = await apiClient.get<{ data: { blog: { slug: string } | null } }>('/blogs/me');
  return data?.data?.blog ?? null;
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl p-4 shadow-card animate-pulse">
      <div className="w-full h-20 rounded-xl bg-neutral-200 mb-3" />
      <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-neutral-100 rounded w-1/2" />
    </div>
  );
}

function BlogsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const { data: blogs, status } = useQuery({
    queryKey: ['blogs', search],
    queryFn: () => fetchBlogs(search),
    staleTime: 5 * 60_000,
  });

  const { data: myBlog } = useQuery({ queryKey: ['blogs', 'me'], queryFn: fetchMyBlog, staleTime: 60_000 });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <div className="mb-3 flex justify-between items-center">
        <h1 className="text-lg font-bold text-neutral-900">{t('blogs.title', 'Blogs')}</h1>
        <Link
          to={myBlog ? '/blogs/$slug' : '/blogs/new'}
          params={myBlog ? { slug: myBlog.slug } : undefined}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700"
        >
          {myBlog ? t('blogs.myDashboard', 'My Blog') : t('blogs.startBlog', 'Start a Blog')}
        </Link>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('blogs.search.placeholder', 'Search blogs…')}
        className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 mb-4 focus:border-primary-500 focus:outline-none"
      />

      {status === 'pending' && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {status === 'success' && blogs.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <p className="text-neutral-500 text-sm">{t('blogs.empty', 'No blogs yet — be the first to start one.')}</p>
        </div>
      )}

      {status === 'success' && blogs.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {blogs.map((b) => (
            <Link key={b.id} to="/blogs/$slug" params={{ slug: b.slug }} className="block bg-white rounded-xl p-4 shadow-card active:scale-95 transition-transform">
              <div className="flex items-center justify-center h-16 rounded-xl bg-neutral-100 text-3xl mb-2">📝</div>
              <p className="font-semibold text-neutral-900 text-sm truncate">{b.title}</p>
              {b.tagline && <p className="text-neutral-500 text-xs mt-0.5 truncate">{b.tagline}</p>}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-neutral-400">{b.post_count} posts</span>
                {b.show_subscriber_count && <span className="text-xs text-emerald-600">{b.subscriber_count} subs</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/blogs/')({
  component: BlogsPage,
});
