"use client";

/**
 * components/portals/PortalView.tsx
 *
 * The interactive body of a Portal page (/h/<slug>): hero, follow/share,
 * the mini discovery feed (Top / New) and every enabled section (rooms,
 * guilds, people, official forum, Q&A, wiki, blogs, polls & quizzes).
 *
 * The cached server payload is rendered immediately (it is also in the SSR
 * HTML for crawlers); only "load more", the New tab and follow state hit the
 * network. Sections with nothing to show render nothing, so a young portal
 * never shows a wall of empty boxes.
 */

import Link from "@/components/ui/Link";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AdSlot from "@/components/ads/AdSlot";
import { Icon } from "@/components/ui/Icon";
import { timeAgo } from "@/components/tweets/types";
import { HashtagText } from "./HashtagText";
import { FollowPortalButton } from "./FollowPortalButton";
import { useAuth } from "@/lib/auth/hooks";
import { PortalViewTracker } from "./PortalViewTracker";
import { portalPath } from "@zobia/shared/utils";
import type { PortalFeedItem, PortalFeedPage, PortalPayload, PortalSectionKey } from "@zobia/types";

const FEED_PAGE = 12;

const TYPE_ICON: Record<string, string> = {
  moment: "⚡",
  tweet: "🐦",
  blog_post: "✍️",
  forum_thread: "🗨️",
  forum_question: "❓",
  room: "🚪",
  classroom: "🏫",
  wiki_page: "📖",
  poll: "🗳️",
  quiz: "🧠",
};

function ItemRow({ item }: { item: PortalFeedItem }) {
  const { t } = useTranslation();
  return (
    <Link
      href={item.url}
      className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3 transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
    >
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <Icon emoji={TYPE_ICON[item.contentType] ?? "📄"} size={22} />
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

export function PortalView({ initial }: { initial: PortalPayload }) {
  const { t } = useTranslation();
  const { portal, sections } = initial;
  const slug = portal.slug;
  // A "tag page": a hashtag with content but no portal row. Read-only: no follow, no view counter.
  const isTag = portal.status === "tag";
  const { user } = useAuth();
  const accent = portal.accentColor ?? "#0d9488";

  const [followers, setFollowers] = useState(portal.followerCount);
  const [sort, setSort] = useState<"top" | "new">("top");
  // The embedded payload is page 1 of "top"; its "load more" cursor is the
  // server's offset cursor ({ offset: n }, base64 JSON) at the end of that page.
  const [pages, setPages] = useState<Record<"top" | "new", { items: PortalFeedItem[]; cursor: string | null; loaded: boolean }>>({
    top: {
      items: sections.feed,
      cursor: sections.feed.length >= FEED_PAGE ? btoa(JSON.stringify({ offset: sections.feed.length })) : null,
      loaded: true,
    },
    new: { items: [], cursor: null, loaded: false },
  });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchFeed = useCallback(
    async (which: "top" | "new", cursor: string | null): Promise<PortalFeedPage | null> => {
      const params = new URLSearchParams({ sort: which, limit: String(FEED_PAGE) });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/public/portals/${encodeURIComponent(slug)}/feed?${params.toString()}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: PortalFeedPage };
      return json.data ?? null;
    },
    [slug]
  );

  const loadMore = useCallback(
    async (which: "top" | "new") => {
      if (loading) return;
      setLoading(true);
      try {
        const page = await fetchFeed(which, pages[which].cursor);
        if (!page) return;
        setPages((prev) => ({
          ...prev,
          [which]: { items: [...prev[which].items, ...page.items], cursor: page.nextCursor, loaded: true },
        }));
      } finally {
        setLoading(false);
      }
    },
    [fetchFeed, loading, pages]
  );

  const switchSort = (next: "top" | "new") => {
    setSort(next);
    if (next === "new" && !pages.new.loaded) void loadMore("new");
  };

  const share = async () => {
    const url = `${window.location.origin}${portalPath(slug)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: portal.title, text: portal.tagline ?? portal.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* user cancelled */
    }
  };

  const current = pages[sort];
  const canLoadMore = sort === "top" ? !!pages.top.cursor : !pages.new.loaded || !!pages.new.cursor;

  const order = useMemo(() => portal.sections.filter((s) => s.enabled).map((s) => s.key), [portal.sections]);

  const render = (key: PortalSectionKey): React.ReactNode => {
    switch (key) {
      case "feed":
        return (
          <Section
            key={key}
            title={t("portals.section.feed")}
            icon="🔥"
            action={
              <div className="flex rounded-full bg-neutral-100 p-0.5 text-xs font-semibold dark:bg-neutral-800" role="tablist">
                {(["top", "new"] as const).map((s) => (
                  <button
                    key={s}
                    role="tab"
                    aria-selected={sort === s}
                    onClick={() => switchSort(s)}
                    className={`rounded-full px-3 py-1 ${sort === s ? "bg-white shadow dark:bg-neutral-700" : "text-neutral-500"}`}
                  >
                    {t(`portals.sort.${s}`)}
                  </button>
                ))}
              </div>
            }
          >
            {current.items.length === 0 && !loading ? (
              <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
                {t("portals.feedEmpty", { tag: slug })}
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
                className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {loading ? t("feedTabs.loadingMore") : t("feedTabs.loadMore")}
              </button>
            )}
          </Section>
        );
      case "rooms":
        return sections.rooms.length === 0 ? null : (
          <Section key={key} title={t("portals.section.rooms")} icon="🚪">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sections.rooms.map((r) => (
                <Link
                  key={r.id}
                  href={r.isClassroom ? `/c/${r.slug ?? r.id}` : r.slug ? `/r/${r.slug}` : `/rooms/${r.id}`}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                    <Icon emoji={r.coverEmoji ?? (r.isClassroom ? "🏫" : "🚪")} size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{r.name}</span>
                    <span className="block text-xs text-neutral-500">{t("portals.members", { count: r.memberCount })}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        );
      case "guilds":
        return sections.guilds.length === 0 ? null : (
          <Section key={key} title={t("portals.section.guilds")} icon="🛡️">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sections.guilds.map((g) => (
                <Link
                  key={g.id}
                  href={`/guilds/${g.id}`}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                    <Icon emoji={g.crestEmoji} size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{g.name}</span>
                    <span className="block text-xs text-neutral-500">
                      {t("portals.members", { count: g.memberCount })}
                      {g.city ? ` · ${g.city}` : ""}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        );
      case "people":
        return sections.people.length === 0 ? null : (
          <Section key={key} title={t("portals.section.people")} icon="👥">
            <div className="flex flex-wrap gap-2">
              {sections.people.map((p) => (
                <Link
                  key={p.userId}
                  href={`/u/${p.username}`}
                  className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1 pl-1 pr-3 text-sm hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  {p.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-base dark:bg-neutral-800">{p.avatarEmoji ?? "😊"}</span>
                  )}
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">{p.displayName}</span>
                  <span className="text-xs text-neutral-400">{t("portals.postsCount", { count: p.postCount })}</span>
                </Link>
              ))}
            </div>
          </Section>
        );
      case "forum":
        return sections.forum.length === 0 && !sections.forumBoard ? null : (
          <Section
            key={key}
            title={t("portals.section.forum")}
            icon="🗨️"
            action={
              sections.forumBoard && (
                <Link href={`/forum/${sections.forumBoard.slug}`} className="text-xs font-semibold text-primary hover:underline">
                  {t("portals.openForum", { name: sections.forumBoard.name })}
                </Link>
              )
            }
          >
            {sections.forum.length > 0 && <ItemList items={sections.forum} />}
          </Section>
        );
      case "questions":
        return sections.questions.length === 0 ? null : (
          <Section key={key} title={t("portals.section.questions")} icon="❓" action={<Link href="/answers" className="text-xs font-semibold text-primary hover:underline">{t("portals.seeAll")}</Link>}>
            <ItemList items={sections.questions} />
          </Section>
        );
      case "wiki":
        return sections.wiki.length === 0 ? null : (
          <Section key={key} title={t("portals.section.wiki")} icon="📖">
            <ItemList items={sections.wiki} />
          </Section>
        );
      case "blogs":
        return sections.blogs.length === 0 ? null : (
          <Section key={key} title={t("portals.section.blogs")} icon="✍️">
            <ItemList items={sections.blogs} />
          </Section>
        );
      case "polls":
        return sections.polls.length === 0 ? null : (
          <Section key={key} title={t("portals.section.polls")} icon="🗳️">
            <ItemList items={sections.polls} />
          </Section>
        );
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      {!isTag && <PortalViewTracker slug={slug} />}

      <header className="-mx-4 mb-4 overflow-hidden sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <div
          className="relative h-36 w-full bg-cover bg-center sm:h-44"
          style={portal.coverImageUrl ? { backgroundImage: `url(${portal.coverImageUrl})` } : { background: `linear-gradient(135deg, ${accent}, ${accent}88)` }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 text-white">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold drop-shadow">
                <span style={{ color: accent, filter: "brightness(1.6)" }}>#</span>
                {portal.slug}
              </h1>
              {portal.status === "official" && (
                <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold backdrop-blur">
                  <Icon emoji="✓" size={11} /> {t("portals.official")}
                </span>
              )}
              {portal.status === "auto" && (
                <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold backdrop-blur">
                  <Icon emoji="🔥" size={11} /> {t("portals.trendingBadge")}
                </span>
              )}
              {isTag && (
                <span className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold backdrop-blur">
                  <Icon emoji="🏷️" size={11} /> {t("portals.tagBadge")}
                </span>
              )}
              {portal.status === "archived" && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold backdrop-blur">{t("portals.archivedBadge")}</span>
              )}
              {portal.sponsorName && (
                <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[11px] font-bold text-amber-950">{t("portals.sponsoredBy", { name: portal.sponsorName })}</span>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-3 bg-white p-4 dark:bg-neutral-900">
          <div>
            <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{portal.title}</p>
            {portal.tagline && <p className="text-sm text-neutral-500 dark:text-neutral-400">{portal.tagline}</p>}
            {portal.description && <p className="mt-2 whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-300">{portal.description}</p>}
          </div>
          {isTag && <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("portals.tagPageHint", { tag: slug })}</p>}
          {isTag && user?.is_admin && (
            <Link href={`/gate44/portals?make=${encodeURIComponent(slug)}`} className="inline-block text-sm font-semibold text-primary hover:underline">
              {t("portals.makeOfficial")}
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!isTag && <FollowPortalButton slug={slug} onCountChange={setFollowers} />}
            <button
              type="button"
              onClick={share}
              className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {copied ? t("portals.linkCopied") : t("portals.share")}
            </button>
            <p className="ml-auto text-xs text-neutral-500">
              {!isTag && <>{t("portals.followers", { count: followers })}</>}
              {portal.activityCount > 0 && <>{!isTag && " · "}{t("portals.activeNow", { count: portal.activityCount })}</>}
            </p>
          </div>
        </div>
      </header>

      <div className="mb-4 flex justify-center">
        <AdSlot placement="portal_top" />
      </div>

      <div className="space-y-8">{order.map((key) => render(key))}</div>

      <div className="mt-8 flex justify-center">
        <AdSlot placement="portal_bottom" />
      </div>

      <div className="mt-8">
        <Link href="/h" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          <Icon emoji="←" className="inline h-3.5 w-3.5 align-text-bottom" /> {t("portals.allPortals")}
        </Link>
      </div>
    </div>
  );
}
