/**
 * apps/android/src/routes/h/index.tsx
 *
 * Portals discovery hub (/h) — mirrors apps/web/components/portals/PortalDiscoverHub.tsx:
 * one search box; Featured, Trending hashtags, Your portals, Rising, Places &
 * schools, New and Popular from ONE cached payload (GET /api/public/portals/discover),
 * plus a "Browse all" grid with sort tabs. Searching swaps the sections for live
 * results across hashtags and portals. Trending hashtags include tags with no
 * portal (they open a read-only tag page). React-query persists everything per
 * user, so the hub also renders offline from the last load.
 */

import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { Icon } from '@/components/ui/Icon';
import { PortalCardTile } from '@/components/portals/PortalCardTile';
import { usePortalDiscover } from '@/components/portals/TrendingTagsStrip';
import type { PortalCard } from '@zobia/shared/types';

type Tab = 'trending' | 'followers' | 'new';

interface TagHit {
  slug: string;
  useCount: number;
  hasPortal: boolean;
}

function Row({ title, icon, portals, wide = false }: { title: string; icon: string; portals: PortalCard[]; wide?: boolean }) {
  if (portals.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon emoji={icon} size={18} />
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{title}</h2>
      </div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        {portals.map((p) => (
          <PortalCardTile key={p.id} portal={p} src="search" className={`${wide ? 'w-64' : 'w-44'} shrink-0 snap-start`} />
        ))}
      </div>
    </section>
  );
}

function PortalsHubPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [tab, setTab] = useState<Tab>('trending');

  useEffect(() => {
    const h = setTimeout(() => setDq(q.trim().replace(/^#/, '')), 250);
    return () => clearTimeout(h);
  }, [q]);

  const isSearching = dq.length >= 2;
  const hub = usePortalDiscover();

  const following = useQuery({
    queryKey: ['portals', 'following'],
    queryFn: async () => (await apiClient.get<{ portals: PortalCard[] }>('/portals/following')).data?.portals ?? [],
  });

  const search = useQuery({
    queryKey: ['portals', 'search', dq],
    enabled: isSearching,
    queryFn: async () => {
      const [tags, portals] = await Promise.all([
        apiClient.get<{ hashtags: TagHit[] }>(`/public/hashtags/search?q=${encodeURIComponent(dq)}&limit=12`),
        apiClient.get<{ portals: PortalCard[] }>(`/public/portals?q=${encodeURIComponent(dq)}&limit=12&sort=followers`),
      ]);
      return { tags: tags.data?.hashtags ?? [], portals: portals.data?.portals ?? [] };
    },
  });

  const all = useQuery({
    queryKey: ['portals', 'list', tab],
    queryFn: async () => (await apiClient.get<{ portals: PortalCard[] }>(`/public/portals?sort=${tab}&limit=36`)).data?.portals ?? [],
    staleTime: 60_000,
  });

  const d = hub.data;
  const nothing = !!d && d.featured.length + d.trendingTags.length + d.rising.length + d.places.length + d.newest.length + d.popular.length === 0;

  return (
    <div className="space-y-6 p-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-neutral-900 dark:text-neutral-100">
          <Icon emoji="🧭" size={24} /> {t('portals.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t('portals.subtitle')}</p>
      </header>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('portals.hub.searchPlaceholder')}
        aria-label={t('portals.hub.searchPlaceholder')}
        maxLength={60}
        className="w-full rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2.5 text-sm outline-none"
      />

      {isSearching ? (
        <div className="space-y-5">
          {(search.data?.tags.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{t('portals.hub.tags')}</h2>
              <div className="flex flex-wrap gap-2">
                {search.data!.tags.map((tg) => (
                  <Link key={tg.slug} to="/h/$slug" params={{ slug: tg.slug }} search={{}} className="rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-1.5 text-sm font-medium">
                    #{tg.slug}
                    <span className="ml-1.5 text-xs text-neutral-400">{t('portals.postsCount', { count: tg.useCount })}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {(search.data?.portals.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{t('portals.hub.portals')}</h2>
              <div className="grid grid-cols-2 gap-3">
                {search.data!.portals.map((p) => (
                  <PortalCardTile key={p.id} portal={p} src="search" />
                ))}
              </div>
            </section>
          )}
          {search.isSuccess && search.data.tags.length === 0 && search.data.portals.length === 0 && (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-10 text-center">
              <div className="mb-2"><Icon emoji="🔍" size={30} /></div>
              <p className="text-sm text-neutral-500">{t('portals.hub.noResults', { q: dq })}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {d && (
            <>
              <Row title={t('portals.hub.featured')} icon="⭐" portals={d.featured} wide />
              {d.trendingTags.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon emoji="🔥" size={18} />
                    <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{t('portals.hub.trendingTags')}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.trendingTags.map((tg) => (
                      <Link key={tg.slug} to="/h/$slug" params={{ slug: tg.slug }} search={{}} className="rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                        #{tg.slug}
                        <span className="ml-1.5 text-xs text-neutral-400">{t('portals.postsCount', { count: tg.postCount })}</span>
                        {tg.hasPortal && <span className="ml-1 text-[10px] text-neutral-400">{t('portals.portalTag')}</span>}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
              <Row title={t('portals.hub.yours')} icon="💙" portals={following.data ?? []} />
              <Row title={t('portals.hub.rising')} icon="📈" portals={d.rising} />
              <Row title={t('portals.hub.places')} icon="📍" portals={d.places} />
              <Row title={t('portals.hub.newest')} icon="✨" portals={d.newest} />
              <Row title={t('portals.hub.popular')} icon="👥" portals={d.popular} />
            </>
          )}

          {hub.isError && !d && (
            <p className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">{t('portals.loadError')}</p>
          )}

          {nothing && (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-10 text-center">
              <div className="mb-2"><Icon emoji="🧭" size={32} /></div>
              <p className="text-sm text-neutral-500">{t('portals.empty')}</p>
              <Link to="/tweets/create" className="mt-3 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white">
                {t('portals.hub.startTagging')}
              </Link>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-neutral-900 dark:text-neutral-100">
              <Icon emoji="🗂️" size={18} /> {t('portals.hub.browseAll')}
            </h2>
            <div className="flex gap-1 overflow-x-auto" role="tablist">
              {(['trending', 'followers', 'new'] as const).map((tb) => (
                <button
                  key={tb}
                  role="tab"
                  aria-selected={tab === tb}
                  onClick={() => setTab(tb)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${tab === tb ? 'bg-primary-600 text-white' : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'}`}
                >
                  {t(`portals.tab.${tb}`)}
                </button>
              ))}
            </div>
            {all.isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-700" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {(all.data ?? []).map((p) => <PortalCardTile key={p.id} portal={p} src="search" />)}
              </div>
            )}
          </section>

          <p className="rounded-xl bg-neutral-100 dark:bg-neutral-800 p-3 text-xs text-neutral-500 dark:text-neutral-400">{t('portals.hub.howItWorks')}</p>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/h/')({
  component: PortalsHubPage,
});
