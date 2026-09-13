/**
 * apps/android/src/components/home/FeedItemCard.tsx
 *
 * One Home Feed card, content-type-agnostic per lib/feed/types.ts FeedItem
 * — mirrors apps/web/components/home/FeedItemCard.tsx. Renders
 * title/excerpt/image/relative-time and a click-through to the item's
 * deep link (FeedItem.url, computed server-side — see lib/feed/deeplink.ts
 * for how each content type's path resolves to a route in this app,
 * in-app real routes for most types and thin redirect-shim routes for the
 * few slug-keyed ones).
 */

import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { feedItemPath } from '@/lib/feed/deeplink';
import type { FeedContentType, FeedItem } from '@/lib/feed/types';

const CONTENT_TYPE_ICON: Record<FeedContentType, string> = {
  moment: '⚡',
  tweet: '🐦',
  blog_post: '✍️',
  forum_thread: '🗨️',
  forum_question: '❓',
  room: '🚪',
  wiki_page: '📖',
  game: '🎮',
  classroom: '🏫',
  business_page_post: '🏢',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function FeedItemCard({ item }: { item: FeedItem }) {
  const { t } = useTranslation();
  const metricEntries = item.metrics ? Object.entries(item.metrics).slice(0, 3) : [];
  const to = feedItemPath(item.contentType, item.contentId, item.url);

  return (
    <Link
      to={to as never}
      className="flex gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 shadow-sm transition-colors active:bg-neutral-50 dark:active:bg-neutral-800"
    >
      {item.imageUrl ? (
        <img src={item.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-2xl">
          {CONTENT_TYPE_ICON[item.contentType] ?? '📄'}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {t(`feedTabs.contentType.${item.contentType}`)}
          </span>
          {(item.isBoosted || item.isInHouseBoosted) && (
            <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
              {t('feedTabs.sponsored')}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">{timeAgo(item.createdAt)}</span>
        </div>
        {item.title && <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</p>}
        {item.excerpt && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{item.excerpt}</p>}
        {metricEntries.length > 0 && (
          <div className="mt-1.5 flex gap-3 text-[11px] text-neutral-400 dark:text-neutral-500">
            {metricEntries.map(([key, value]) => (
              <span key={key}>
                {value.toLocaleString()} {key}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export function FeedItemCardSkeleton() {
  return (
    <div className="flex animate-pulse gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 shadow-sm">
      <div className="h-16 w-16 shrink-0 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
      </div>
    </div>
  );
}
