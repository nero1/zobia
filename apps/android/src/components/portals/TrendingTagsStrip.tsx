/**
 * apps/android/src/components/portals/TrendingTagsStrip.tsx
 *
 * Mirrors apps/web/components/portals/TrendingTagsStrip.tsx: a slim row of
 * trending hashtags above the For You feed, from the cached public hub payload
 * (react-query, persisted, so it also renders offline). Renders nothing when
 * there is no trend or the request fails.
 */

import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { Icon } from '@/components/ui/Icon';
import type { PortalDiscover } from '@zobia/shared/types';

export function usePortalDiscover() {
  return useQuery({
    queryKey: ['portals', 'discover'],
    queryFn: async () => (await apiClient.get<PortalDiscover>('/public/portals/discover')).data,
    staleTime: 10 * 60_000,
  });
}

export function TrendingTagsStrip() {
  const { t } = useTranslation();
  const { data } = usePortalDiscover();
  const tags = (data?.trendingTags ?? []).slice(0, 10);
  if (tags.length === 0) return null;
  return (
    <nav aria-label={t('portals.hub.trendingTags')} className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
      <Link to="/h" className="flex shrink-0 items-center gap-1 rounded-full bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white">
        <Icon emoji="🧭" size={12} /> {t('portals.title')}
      </Link>
      {tags.map((tg) => (
        <Link
          key={tg.slug}
          to="/h/$slug"
          params={{ slug: tg.slug }}
          search={{}}
          className="shrink-0 rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200"
        >
          #{tg.slug}
        </Link>
      ))}
    </nav>
  );
}
