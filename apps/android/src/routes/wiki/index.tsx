/**
 * apps/android/src/routes/wiki/index.tsx
 *
 * Wiki discovery — mirrors routes/blogs/index.tsx's search + card grid.
 * The backend exposes 4 sort tabs (popular/trending/new/random) — rather
 * than a full horizontal tab bar (web/PWA-only per this app's mobile
 * simplification convention), this reuses the same compact segmented
 * control already used elsewhere on Android for a small fixed option set
 * (see routes/blogs/$slug/manage.tsx's published/draft toggle and
 * routes/admin/blogs.tsx's AdminTabs) instead of inventing a new pattern.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { fetchWikiList, fetchMyWikis, type WikiTab } from '@/lib/wiki/api';
import { WikiCard, WikiCardSkeleton } from '@/components/wiki/WikiCard';

const TABS: WikiTab[] = ['popular', 'trending', 'new', 'random'];

function WikiDiscoveryPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<WikiTab>('popular');

  const { data, status } = useQuery({
    queryKey: ['wiki', 'list', tab, search],
    queryFn: () => fetchWikiList(tab, search),
    staleTime: 5 * 60_000,
  });

  const { data: mine } = useQuery({ queryKey: ['wiki', 'me'], queryFn: fetchMyWikis, staleTime: 60_000 });
  const myFirstWiki = mine?.owned?.[0] ?? null;

  const tabLabel: Record<WikiTab, string> = {
    popular: t('wiki.tab.popular', 'Popular'),
    trending: t('wiki.tab.trending', 'Trending'),
    new: t('wiki.tab.new', 'New'),
    random: t('wiki.tab.random', 'Random'),
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <div className="mb-3 flex justify-between items-center">
        <h1 className="text-lg font-bold text-neutral-900">{t('wiki.title', 'Wikis')}</h1>
        <Link
          to={myFirstWiki ? '/wiki/$slug' : '/wiki/new'}
          params={myFirstWiki ? { slug: myFirstWiki.slug } : undefined}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700"
        >
          {myFirstWiki ? t('wiki.myWikis', 'My Wikis') : t('wiki.startWiki', 'Start a Wiki')}
        </Link>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('wiki.search.placeholder', 'Search wikis…')}
        className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 mb-3 focus:border-primary-500 focus:outline-none"
      />

      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 w-fit overflow-x-auto max-w-full">
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === tb ? 'bg-primary-600 text-white' : 'text-neutral-600'}`}
          >
            {tabLabel[tb]}
          </button>
        ))}
      </div>

      {status === 'pending' && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <WikiCardSkeleton key={i} />)}
        </div>
      )}

      {status === 'success' && (data?.wikis.length ?? 0) === 0 && (
        <div className="flex items-center justify-center py-20">
          <p className="text-neutral-500 text-sm">{t('wiki.empty', 'No wikis yet — be the first to start one.')}</p>
        </div>
      )}

      {status === 'success' && (data?.wikis.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {data!.wikis.map((w) => <WikiCard key={w.id} wiki={w} />)}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/wiki/')({
  component: WikiDiscoveryPage,
});
