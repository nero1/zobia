/**
 * apps/android/src/routes/h/index.tsx
 *
 * Portals directory (/h) — mirrors apps/web/components/portals/PortalDirectory.tsx:
 * search, Trending / Popular / New tabs and, for signed-in users, a Following
 * tab. React-query persists the lists per user, so the directory also renders
 * offline from the last successful load.
 *
 * GET /api/public/portals, GET /api/portals/following.
 */

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { Icon } from '@/components/ui/Icon';
import { PortalCardTile } from '@/components/portals/PortalCardTile';
import type { PortalCard } from '@zobia/shared/types';

type Tab = 'trending' | 'followers' | 'new' | 'following';

function PortalsDirectoryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('trending');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);

  const list = useQuery({
    queryKey: ['portals', 'list', tab === 'following' ? 'trending' : tab, dq],
    enabled: tab !== 'following',
    queryFn: async () => {
      const params = new URLSearchParams({ sort: tab === 'following' ? 'trending' : tab, limit: '36' });
      if (dq) params.set('q', dq);
      return (await apiClient.get<{ portals: PortalCard[] }>(`/public/portals?${params}`)).data?.portals ?? [];
    },
    staleTime: 60_000,
  });

  const following = useQuery({
    queryKey: ['portals', 'following'],
    queryFn: async () => (await apiClient.get<{ portals: PortalCard[] }>('/portals/following')).data?.portals ?? [],
  });

  const portals = tab === 'following' ? following.data ?? [] : list.data ?? [];
  const loading = tab === 'following' ? following.isLoading : list.isLoading;
  const failed = tab === 'following' ? following.isError : list.isError;

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-neutral-900 dark:text-neutral-100">
          <Icon emoji="🧭" size={24} /> {t('portals.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t('portals.subtitle')}</p>
      </header>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (tab === 'following') setTab('trending');
        }}
        placeholder={t('portals.searchPlaceholder')}
        aria-label={t('portals.searchPlaceholder')}
        maxLength={60}
        className="w-full rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2.5 text-sm outline-none"
      />

      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {(['trending', 'followers', 'new', 'following'] as const).map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${
              tab === tb ? 'bg-primary-600 text-white' : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
            }`}
          >
            {t(`portals.tab.${tb}`)}
          </button>
        ))}
      </div>

      {failed && portals.length === 0 ? (
        <p className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">{t('portals.loadError')}</p>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-700" />
          ))}
        </div>
      ) : portals.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-10 text-center">
          <div className="mb-2"><Icon emoji="🧭" size={32} /></div>
          <p className="text-sm text-neutral-500">{tab === 'following' ? t('portals.followingEmpty') : t('portals.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {portals.map((p) => (
            <PortalCardTile key={p.id} portal={p} src="search" />
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/h/')({
  component: PortalsDirectoryPage,
});
