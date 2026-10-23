'use client';
import { useEffect, useState } from 'react';
import Link from '@/components/ui/Link';
import { useTranslation } from 'react-i18next';
type Tab = 'popular' | 'trending' | 'new' | 'random' | 'subscribed';
interface Post { id: string; slug: string; title: string; blog_slug: string; blog_title: string; featured_image_url: string | null; is_paywalled: boolean; }
export function PostDiscovery({ search }: { search: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('popular');
  const [page, setPage] = useState<{ posts: Post[]; nextCursor: string | null }>({ posts: [], nextCursor: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => { setCursor(null); setPage({ posts: [], nextCursor: null }); }, [tab, search]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ tab, q: search });
    if (cursor) params.set('cursor',cursor);
    setLoading(true); setError('');
    fetch(`/api/blogs/discover-posts?${params}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'Unable to load posts.'); return body.data; })
      .then((data) => setPage((old) => ({ posts: cursor ? [...old.posts,...data.posts].filter((p,i,all) => all.findIndex((x) => x.id === p.id) === i) : data.posts, nextCursor: data.nextCursor })))
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tab, search, cursor, retry]);
  return <section className="mt-8" aria-label={t('blogs.posts.title','Posts')}>
    <h2 className="text-xl font-bold mb-3">{t('blogs.posts.title','Posts')}</h2>
    <div className="flex overflow-x-auto gap-2 mb-4">{(['popular','trending','new','random','subscribed'] as Tab[]).map((item) => <button type="button" key={item} aria-pressed={tab===item} onClick={() => setTab(item)} className={`rounded-full px-3 py-2 text-sm ${tab===item?'bg-primary text-primary-foreground':'border border-border'}`}>{t(`blogs.tab.${item}`,item.charAt(0).toUpperCase()+item.slice(1))}</button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2">{page.posts.map((post) => <Link key={post.id} href={`/b/${encodeURIComponent(post.blog_slug)}/${encodeURIComponent(post.slug)}`} className="flex gap-3 rounded-xl border border-border p-3 bg-card">
      {post.featured_image_url ? <img src={post.featured_image_url} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0" /> : <span className="flex items-center justify-center w-20 h-20 rounded-lg bg-muted text-3xl shrink-0" aria-hidden>📝</span>}
      <div><p className="text-xs text-muted-foreground">{post.blog_title}</p><h3 className="text-lg font-semibold line-clamp-2">{post.title}</h3>{post.is_paywalled && <span className="text-xs">{t('blogs.posts.locked','Paid article')}</span>}</div>
    </Link>)}</div>
    {!loading && !error && !page.posts.length && <p className="text-muted-foreground py-6">{t('blogs.posts.empty','No published posts found.')}</p>}
    {error && <p role="alert" className="mt-3">{error} <button type="button" onClick={() => setRetry((n)=>n+1)}>{t('common.retry','Retry')}</button></p>}
    {loading ? <p role="status" className="py-4">{t('blogs.loading','Loading…')}</p> : page.nextCursor && !error && <button type="button" onClick={() => setCursor(page.nextCursor)} className="block mx-auto mt-4 border border-border rounded-full px-5 py-2">{t('blogs.loadMore','Load more')}</button>}
  </section>;
}
