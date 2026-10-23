import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
interface Post { id: string; slug: string; title: string; blog_slug: string; blog_title: string; featured_image_url: string | null; is_paywalled: boolean; }
type Tab = 'popular'|'trending'|'new'|'random'|'subscribed';
export function PostDiscovery({ search }: { search: string }) {
  const { t } = useTranslation(); const [tab,setTab] = useState<Tab>('popular');
  const posts = useInfiniteQuery({ queryKey: ['blogPostDiscovery',tab,search], initialPageParam: null as string|null,
    queryFn: async ({ pageParam }) => { const p = new URLSearchParams({tab,q:search}); if(pageParam) p.set('cursor',pageParam); const {data} = await apiClient.get<{posts:Post[];nextCursor:string|null}>(`/blogs/discover-posts?${p}`); return data; },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = posts.data?.pages.flatMap((p)=>p.posts).filter((p,i,all)=>all.findIndex((x)=>x.id===p.id)===i) ?? [];
  return <section className="mt-8"><h2 className="text-xl font-bold mb-3">{t('blogs.posts.title','Posts')}</h2>
    <div className="flex gap-2 overflow-x-auto mb-4">{(['popular','trending','new','random','subscribed'] as Tab[]).map((item)=><button key={item} type="button" onClick={()=>setTab(item)} aria-pressed={tab===item} className={`rounded-full px-3 py-2 text-sm ${tab===item?'bg-primary-600 text-white':'bg-white text-neutral-800 border'}`}>{t(`blogs.tab.${item}`,item.charAt(0).toUpperCase()+item.slice(1))}</button>)}</div>
    <div className="grid gap-3">{items.map((post)=><Link key={post.id} to="/blogs/$slug/$postSlug" params={{slug:post.blog_slug,postSlug:post.slug}} className="flex gap-3 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 p-3">
      {post.featured_image_url?<img src={post.featured_image_url} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0"/>:<span aria-hidden className="w-20 h-20 flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 rounded-lg text-3xl shrink-0">📝</span>}
      <div><p className="text-xs text-neutral-500">{post.blog_title}</p><h3 className="text-lg font-semibold line-clamp-2">{post.title}</h3>{post.is_paywalled&&<span className="text-xs">{t('blogs.posts.locked','Paid article')}</span>}</div>
    </Link>)}</div>
    {posts.isPending||posts.isFetchingNextPage?<p role="status" className="py-4">{t('blogs.loading','Loading…')}</p>:!posts.isError&&!items.length&&<p className="py-4 text-neutral-500">{t('blogs.posts.empty','No published posts found.')}</p>}
    {posts.isError&&<p role="alert">{t('blogs.posts.error','Unable to load posts.')} <button type="button" onClick={()=>void posts.refetch()}>{t('common.retry','Retry')}</button></p>}
    {posts.hasNextPage&&!posts.isFetchingNextPage&&<button type="button" onClick={()=>void posts.fetchNextPage()} className="block mx-auto mt-4 border rounded-full px-5 py-2">{t('blogs.loadMore','Load more')}</button>}
  </section>;
}
