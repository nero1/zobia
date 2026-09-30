/**
 * apps/android/src/components/portals/PortalView.tsx
 *
 * Mirrors apps/web/components/portals/PortalView.tsx: hero, follow/share, the
 * mini discovery feed (Top / New, infinite-scroll-friendly "load more") and
 * every enabled section. Sections with nothing to show render nothing.
 *
 * Offline: the payload comes through react-query (persisted per user by
 * lib/query), so a previously visited portal still renders without a network.
 */

import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import AdSlot from '@/components/ads/AdSlot';
import { Icon } from '@/components/ui/Icon';
import { HashtagText } from './HashtagText';
import { FollowPortalButton } from './FollowPortalButton';
import { referralLink } from '@/lib/deeplinks/routes';
import { portalPath } from '@zobia/shared/utils';
import type { PortalFeedItem, PortalFeedPage, PortalPayload, PortalSectionKey } from '@zobia/shared/types';

const FEED_PAGE = 12;
const VIEWED_KEY = 'zobia:portals:viewed:v1';

const TYPE_ICON: Record<string, string> = {
  moment: '⚡',
  tweet: '🐦',
  blog_post: '✍️',
  forum_thread: '🗨️',
  forum_question: '❓',
  room: '🚪',
  classroom: '🏫',
  wiki_page: '📖',
  poll: '🗳️',
  quiz: '🧠',
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function ItemRow({ item }: { item: PortalFeedItem }) {
  const { t } = useTranslation();
  return (
    <Link
      to={item.url as never}
      className="flex gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3"
    >
      {item.imageUrl ? (
        <img src={item.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-700">
          <Icon emoji={TYPE_ICON[item.contentType] ?? '📄'} size={22} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2 text-[11px] text-neutral-400">
          <span className="font-semibold uppercase tracking-wide">{t(`feedTabs.contentType.${item.contentType}`, item.contentType)}</span>
          <span className="ml-auto shrink-0">{timeAgo(item.createdAt)}</span>
        </div>
        {item.title && <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</p>}
        {item.excerpt && (
          <p className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
            <HashtagText text={item.excerpt} plain />
          </p>
        )}
      </div>
    </Link>
  );
}

function Section({ title, icon, children, action }: { title: string; icon: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon emoji={icon} size={18} />
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function ItemList({ items }: { items: PortalFeedItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <ItemRow key={`${it.contentType}:${it.contentId}`} item={it} />
      ))}
    </div>
  );
}

/** Records one view per portal per day (+ a click for `src=feed`), deduped in localStorage. */
function usePortalView(slug: string, src: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const today = new Date().toISOString().slice(0, 10);
    let seen: Record<string, string> = {};
    try {
      seen = JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '{}') as Record<string, string>;
    } catch {
      seen = {};
    }
    if (seen[slug] === today) return;
    apiClient
      .post(`/public/portals/${encodeURIComponent(slug)}/view`, { src: src === 'feed' || src === 'search' ? src : 'direct' })
      .then(() => {
        seen[slug] = today;
        try {
          localStorage.setItem(VIEWED_KEY, JSON.stringify(Object.fromEntries(Object.entries(seen).slice(-200))));
        } catch {
          /* best-effort */
        }
      })
      .catch(() => {});
  }, [slug, src, enabled]);
}

export function PortalView({ payload, src, referralCode }: { payload: PortalPayload; src?: string; referralCode?: string | null }) {
  const { t } = useTranslation();
  const { portal, sections } = payload;
  const slug = portal.slug;
  const accent = portal.accentColor ?? '#0d9488';
  // A "tag page" (a hashtag with content but no portal row) is read-only: no follow, no view counter.
  const isTag = portal.status === 'tag';
  usePortalView(slug, src, !isTag);

  const [followers, setFollowers] = useState(portal.followerCount);
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [pages, setPages] = useState<Record<'top' | 'new', { items: PortalFeedItem[]; cursor: string | null; loaded: boolean }>>({
    top: {
      items: sections.feed,
      cursor: sections.feed.length >= FEED_PAGE ? btoa(JSON.stringify({ offset: sections.feed.length })) : null,
      loaded: true,
    },
    new: { items: [], cursor: null, loaded: false },
  });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadMore = useCallback(
    async (which: 'top' | 'new') => {
      if (loading) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ sort: which, limit: String(FEED_PAGE) });
        if (pages[which].cursor) params.set('cursor', pages[which].cursor!);
        const { data } = await apiClient.get<PortalFeedPage>(`/public/portals/${encodeURIComponent(slug)}/feed?${params}`);
        if (!data) return;
        setPages((prev) => ({ ...prev, [which]: { items: [...prev[which].items, ...data.items], cursor: data.nextCursor, loaded: true } }));
      } catch {
        /* non-fatal — retry via the button */
      } finally {
        setLoading(false);
      }
    },
    [loading, pages, slug]
  );

  const switchSort = (next: 'top' | 'new') => {
    setSort(next);
    if (next === 'new' && !pages.new.loaded) void loadMore('new');
  };

  const share = async () => {
    const url = referralLink(portalPath(slug), referralCode);
    try {
      if (navigator.share) {
        await navigator.share({ title: portal.title, text: portal.tagline ?? portal.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* cancelled */
    }
  };

  const current = pages[sort];
  const canLoadMore = sort === 'top' ? !!pages.top.cursor : !pages.new.loaded || !!pages.new.cursor;
  const order = useMemo(() => portal.sections.filter((s) => s.enabled).map((s) => s.key), [portal.sections]);

  const render = (key: PortalSectionKey): React.ReactNode => {
    switch (key) {
      case 'feed':
        return (
          <Section
            key={key}
            title={t('portals.section.feed')}
            icon="🔥"
            action={
              <div className="flex rounded-full bg-neutral-100 dark:bg-neutral-700 p-0.5 text-xs font-semibold" role="tablist">
                {(['top', 'new'] as const).map((s) => (
                  <button
                    key={s}
                    role="tab"
                    aria-selected={sort === s}
                    onClick={() => switchSort(s)}
                    className={`rounded-full px-3 py-1 ${sort === s ? 'bg-white dark:bg-neutral-600 shadow' : 'text-neutral-500'}`}
                  >
                    {t(`portals.sort.${s}`)}
                  </button>
                ))}
              </div>
            }
          >
            {current.items.length === 0 && !loading ? (
              <p className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-6 text-center text-sm text-neutral-500">
                {t('portals.feedEmpty', { tag: slug })}
              </p>
            ) : (
              <div className="space-y-2">
                {current.items.map((it, i) => (
                  <div key={`${it.contentType}:${it.contentId}`} className="space-y-2">
                    <ItemRow item={it} />
                    {i === 2 && <AdSlot placement="portal_after_3" />}
                  </div>
                ))}
              </div>
            )}
            {canLoadMore && current.items.length > 0 && (
              <button
                type="button"
                onClick={() => loadMore(sort)}
                disabled={loading}
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-600 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-60"
              >
                {loading ? t('feedTabs.loadingMore') : t('feedTabs.loadMore')}
              </button>
            )}
          </Section>
        );
      case 'rooms':
        return sections.rooms.length === 0 ? null : (
          <Section key={key} title={t('portals.section.rooms')} icon="🚪">
            <div className="grid grid-cols-1 gap-2">
              {sections.rooms.map((r) => (
                <Link
                  key={r.id}
                  to={(r.isClassroom ? `/classroom/${r.id}` : `/rooms/${r.id}`) as never}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-700">
                    <Icon emoji={r.coverEmoji ?? (r.isClassroom ? '🏫' : '🚪')} size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{r.name}</span>
                    <span className="block text-xs text-neutral-500">{t('portals.members', { count: r.memberCount })}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        );
      case 'guilds':
        return sections.guilds.length === 0 ? null : (
          <Section key={key} title={t('portals.section.guilds')} icon="🛡️">
            <div className="grid grid-cols-1 gap-2">
              {sections.guilds.map((g) => (
                <Link
                  key={g.id}
                  to="/guilds/$guildId"
                  params={{ guildId: g.id }}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-700">
                    <Icon emoji={g.crestEmoji} size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{g.name}</span>
                    <span className="block text-xs text-neutral-500">
                      {t('portals.members', { count: g.memberCount })}
                      {g.city ? ` · ${g.city}` : ''}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        );
      case 'people':
        return sections.people.length === 0 ? null : (
          <Section key={key} title={t('portals.section.people')} icon="👥">
            <div className="flex flex-wrap gap-2">
              {sections.people.map((p) => (
                <Link
                  key={p.userId}
                  to="/profile/$username"
                  params={{ username: p.username }}
                  className="flex items-center gap-2 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-1 pl-1 pr-3 text-sm"
                >
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-700 text-base">{p.avatarEmoji ?? '😊'}</span>
                  )}
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">{p.displayName}</span>
                  <span className="text-xs text-neutral-400">{t('portals.postsCount', { count: p.postCount })}</span>
                </Link>
              ))}
            </div>
          </Section>
        );
      case 'forum':
        return sections.forum.length === 0 && !sections.forumBoard ? null : (
          <Section
            key={key}
            title={t('portals.section.forum')}
            icon="🗨️"
            action={
              sections.forumBoard && (
                <Link to="/forum/$boardSlug" params={{ boardSlug: sections.forumBoard.slug }} className="text-xs font-semibold text-primary-600">
                  {t('portals.openForum', { name: sections.forumBoard.name })}
                </Link>
              )
            }
          >
            {sections.forum.length > 0 && <ItemList items={sections.forum} />}
          </Section>
        );
      case 'questions':
        return sections.questions.length === 0 ? null : (
          <Section key={key} title={t('portals.section.questions')} icon="❓">
            <ItemList items={sections.questions} />
          </Section>
        );
      case 'wiki':
        return sections.wiki.length === 0 ? null : (
          <Section key={key} title={t('portals.section.wiki')} icon="📖">
            <ItemList items={sections.wiki} />
          </Section>
        );
      case 'blogs':
        return sections.blogs.length === 0 ? null : (
          <Section key={key} title={t('portals.section.blogs')} icon="✍️">
            <ItemList items={sections.blogs} />
          </Section>
        );
      case 'polls':
        return sections.polls.length === 0 ? null : (
          <Section key={key} title={t('portals.section.polls')} icon="🗳️">
            <ItemList items={sections.polls} />
          </Section>
        );
    }
  };

  return (
    <div className="pb-16">
      <header className="overflow-hidden">
        <div
          className="relative h-36 w-full bg-cover bg-center"
          style={portal.coverImageUrl ? { backgroundImage: `url(${portal.coverImageUrl})` } : { background: `linear-gradient(135deg, ${accent}, ${accent}88)` }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 text-white">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold drop-shadow">
                <span style={{ color: accent, filter: 'brightness(1.6)' }}>#</span>
                {portal.slug}
              </h1>
              {portal.status === 'official' && (
                <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
                  <Icon emoji="✓" size={11} /> {t('portals.official')}
                </span>
              )}
              {portal.status === 'auto' && (
                <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
                  <Icon emoji="🔥" size={11} /> {t('portals.trendingBadge')}
                </span>
              )}
              {isTag && (
                <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
                  <Icon emoji="🏷️" size={11} /> {t('portals.tagBadge')}
                </span>
              )}
              {portal.status === 'archived' && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{t('portals.archivedBadge')}</span>}
              {portal.sponsorName && (
                <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[11px] font-bold text-amber-950">{t('portals.sponsoredBy', { name: portal.sponsorName })}</span>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-3 bg-white dark:bg-neutral-800 p-4">
          <div>
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{portal.title}</p>
            {portal.tagline && <p className="text-sm text-neutral-500 dark:text-neutral-400">{portal.tagline}</p>}
            {portal.description && <p className="mt-2 whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-300">{portal.description}</p>}
          </div>
          {isTag && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('portals.tagPageHint', { tag: slug })}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {!isTag && <FollowPortalButton slug={slug} onCountChange={setFollowers} />}
            <button
              type="button"
              onClick={share}
              className="rounded-full border border-neutral-300 dark:border-neutral-600 px-4 py-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200"
            >
              {copied ? t('portals.linkCopied') : t('portals.share')}
            </button>
            <p className="ml-auto text-xs text-neutral-500">
              {!isTag && <>{t('portals.followers', { count: followers })}</>}
              {portal.activityCount > 0 && <>{!isTag && ' · '}{t('portals.activeNow', { count: portal.activityCount })}</>}
            </p>
          </div>
        </div>
      </header>

      <div className="my-4 flex justify-center">
        <AdSlot placement="portal_top" />
      </div>

      <div className="space-y-8 px-4">{order.map((key) => render(key))}</div>

      <div className="mt-8 flex justify-center">
        <AdSlot placement="portal_bottom" />
      </div>

      <div className="mt-6 px-4">
        <Link to="/h" className="text-sm text-neutral-500">
          <Icon emoji="←" size={14} className="inline align-text-bottom" /> {t('portals.allPortals')}
        </Link>
      </div>
    </div>
  );
}
