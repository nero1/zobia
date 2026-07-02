/**
 * apps/android/src/routes/blogs/$slug/index.tsx
 *
 * Blog home — mirrors apps/web/app/b/[slug]/page.tsx: pages menu, articles
 * in reverse-chron order, subscribe toggle.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface BlogDetail {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  subscriber_count: number;
  show_subscriber_count: boolean;
  owner_username: string;
}

interface PostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  is_paywalled: boolean;
  view_count: number;
  like_count: number;
  published_at: string | null;
}

async function fetchBlog(slug: string) {
  // apiClient's response interceptor already unwraps the { success, data, error }
  // envelope down to `data`, so `data` here IS { blog, isSubscribed, ... } already —
  // reading `data.data` was always undefined, so the blog page showed "not found" forever.
  const { data } = await apiClient.get<{ blog: BlogDetail; isSubscribed: boolean }>(`/blogs/${slug}`);
  return data;
}

async function fetchPosts(slug: string, type: 'article' | 'page') {
  // Same double-unwrap bug as fetchBlog above — `data` is already { posts, ... },
  // so `data.data.posts` threw (reading `.posts` of undefined).
  const { data } = await apiClient.get<{ posts: PostSummary[] }>(`/blogs/${slug}/posts?type=${type}&status=published&limit=20`);
  return data?.posts ?? [];
}

function BlogHomePage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const blogQuery = useQuery({ queryKey: ['blogs', 'detail', slug], queryFn: () => fetchBlog(slug) });
  const articlesQuery = useQuery({ queryKey: ['blogs', 'posts', slug, 'article'], queryFn: () => fetchPosts(slug, 'article') });
  const pagesQuery = useQuery({ queryKey: ['blogs', 'posts', slug, 'page'], queryFn: () => fetchPosts(slug, 'page') });

  const toggleSubscribe = useMutation({
    mutationFn: (next: boolean) => (next ? apiClient.post(`/blogs/${slug}/subscribe`, {}) : apiClient.delete(`/blogs/${slug}/subscribe`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blogs', 'detail', slug] }),
  });

  const blog = blogQuery.data?.blog;
  const isSubscribed = blogQuery.data?.isSubscribed ?? false;

  if (blogQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  if (!blog) return <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center text-sm text-neutral-500">{t('blogs.notFound', 'Blog not found.')}</div>;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-neutral-900">{blog.title}</h1>
            {blog.tagline && <p className="text-sm text-neutral-500 mt-0.5">{blog.tagline}</p>}
            <p className="text-xs text-neutral-400 mt-1">@{blog.owner_username}</p>
          </div>
          <button
            onClick={() => toggleSubscribe.mutate(!isSubscribed)}
            disabled={toggleSubscribe.isPending}
            className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${isSubscribed ? 'border border-neutral-300 text-neutral-700' : 'bg-primary-600 text-white'}`}
          >
            {isSubscribed ? t('blogs.subscribed', 'Subscribed ✓') : t('blogs.subscribe', 'Subscribe')}
          </button>
        </div>

        {pagesQuery.data && pagesQuery.data.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
            {pagesQuery.data.map((p) => (
              <Link key={p.id} to="/blogs/$slug/$postSlug" params={{ slug, postSlug: p.slug }} className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700">
                {p.title}
              </Link>
            ))}
          </div>
        )}
      </div>

      {articlesQuery.isPending ? (
        <div className="h-16 rounded bg-neutral-200 animate-pulse" />
      ) : (articlesQuery.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-neutral-500 text-center py-10">{t('blogs.dashboard.empty', 'Nothing here yet.')}</p>
      ) : (
        <div className="space-y-2">
          {articlesQuery.data!.map((a) => (
            <Link key={a.id} to="/blogs/$slug/$postSlug" params={{ slug, postSlug: a.slug }} className="block rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-center gap-1.5">
                <h2 className="font-semibold text-sm text-neutral-900">{a.title}</h2>
                {a.is_paywalled && <span className="text-[10px] rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5">🔒</span>}
              </div>
              {a.excerpt && <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{a.excerpt}</p>}
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-neutral-400">
                {a.published_at && <span>{new Date(a.published_at).toLocaleDateString()}</span>}
                <span>👁 {a.view_count}</span>
                <span>❤️ {a.like_count}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/blogs/$slug/')({
  component: BlogHomePage,
});
