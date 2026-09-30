"use client";

/**
 * components/portals/PortalDiscoverHub.tsx
 *
 * The /h discovery hub: one search box, then Featured, Trending hashtags,
 * Your portals (signed in), Rising, Places & schools, New and Popular, and a
 * full "Browse all" grid (PortalDirectory) for deep paging.
 *
 * All sections come from ONE cached payload (GET /api/public/portals/discover,
 * server-rendered for crawlers). Searching swaps the sections for live
 * results across hashtags and portals. Trending hashtags include tags with no
 * portal: they open a read-only tag page.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { PortalCardTile } from "./PortalCardTile";
import { PortalDirectory } from "./PortalDirectory";
import { useFollowedPortals } from "./useFollowedPortals";
import { portalPath } from "@zobia/shared/utils";
import type { PortalCard, PortalDiscover } from "@zobia/types";

interface TagHit {
  slug: string;
  useCount: number;
  hasPortal: boolean;
}

function Row({ title, icon, portals, wide = false, action }: { title: string; icon: string; portals: PortalCard[]; wide?: boolean; action?: React.ReactNode }) {
  if (portals.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon emoji={icon} size={18} />
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        {portals.map((p) => (
          <PortalCardTile key={p.id} portal={p} src="search" className={`${wide ? "w-64" : "w-44"} shrink-0 snap-start`} />
        ))}
      </div>
    </section>
  );
}

export function PortalDiscoverHub({ initial, directoryInitial }: { initial: PortalDiscover | null; directoryInitial: PortalCard[] }) {
  const { t } = useTranslation();
  const { following } = useFollowedPortals();
  const [hub, setHub] = useState<PortalDiscover | null>(initial);
  const [q, setQ] = useState("");
  const [tagHits, setTagHits] = useState<TagHit[]>([]);
  const [portalHits, setPortalHits] = useState<PortalCard[]>([]);
  const [searching, setSearching] = useState(false);
  const reqId = useRef(0);

  // The SSR payload can be missing (DB hiccup at render time): fetch it client-side.
  useEffect(() => {
    if (hub) return;
    fetch("/api/public/portals/discover")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => json?.data && setHub(json.data as PortalDiscover))
      .catch(() => {});
  }, [hub]);

  const query = q.trim().replace(/^#/, "");
  useEffect(() => {
    if (query.length < 2) {
      setTagHits([]);
      setPortalHits([]);
      setSearching(false);
      return;
    }
    const id = ++reqId.current;
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const [tagsRes, portalsRes] = await Promise.all([
          fetch(`/api/public/hashtags/search?q=${encodeURIComponent(query)}&limit=12`),
          fetch(`/api/public/portals?q=${encodeURIComponent(query)}&limit=12&sort=followers`),
        ]);
        const tags = tagsRes.ok ? ((await tagsRes.json()) as { data?: { hashtags: TagHit[] } }).data?.hashtags ?? [] : [];
        const portals = portalsRes.ok ? ((await portalsRes.json()) as { data?: { portals: PortalCard[] } }).data?.portals ?? [] : [];
        if (id === reqId.current) {
          setTagHits(tags);
          setPortalHits(portals);
        }
      } catch {
        /* keep the previous results */
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(h);
  }, [query]);

  const isSearching = query.length >= 2;
  const nothing =
    !!hub && hub.featured.length + hub.trendingTags.length + hub.rising.length + hub.places.length + hub.newest.length + hub.popular.length === 0;

  return (
    <div className="space-y-6">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
          <Icon emoji="🔍" size={16} />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("portals.hub.searchPlaceholder")}
          aria-label={t("portals.hub.searchPlaceholder")}
          maxLength={60}
          className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      {isSearching ? (
        <div className="space-y-5">
          {tagHits.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{t("portals.hub.tags")}</h2>
              <div className="flex flex-wrap gap-2">
                {tagHits.map((tg) => (
                  <Link key={tg.slug} href={portalPath(tg.slug)} className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:border-primary dark:border-neutral-700 dark:bg-neutral-900">
                    #{tg.slug}
                    <span className="ml-1.5 text-xs text-neutral-400">{t("portals.postsCount", { count: tg.useCount })}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {portalHits.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{t("portals.hub.portals")}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {portalHits.map((p) => (
                  <PortalCardTile key={p.id} portal={p} src="search" />
                ))}
              </div>
            </section>
          )}
          {!searching && tagHits.length === 0 && portalHits.length === 0 && (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
              <div className="mb-2"><Icon emoji="🔍" size={30} /></div>
              <p className="text-sm text-neutral-500">{t("portals.hub.noResults", { q: query })}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {hub && (
            <>
              <Row title={t("portals.hub.featured")} icon="⭐" portals={hub.featured} wide />

              {hub.trendingTags.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon emoji="🔥" size={18} />
                    <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{t("portals.hub.trendingTags")}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hub.trendingTags.map((tg) => (
                      <Link
                        key={tg.slug}
                        href={portalPath(tg.slug)}
                        className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:border-primary hover:text-primary dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                      >
                        #{tg.slug}
                        <span className="ml-1.5 text-xs text-neutral-400">{t("portals.postsCount", { count: tg.postCount })}</span>
                        {tg.hasPortal && <span className="ml-1 text-[10px] text-neutral-400">{t("portals.portalTag")}</span>}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {following && following.length > 0 && <Row title={t("portals.hub.yours")} icon="💙" portals={following} />}
              <Row title={t("portals.hub.rising")} icon="📈" portals={hub.rising} />
              <Row title={t("portals.hub.places")} icon="📍" portals={hub.places} />
              <Row title={t("portals.hub.newest")} icon="✨" portals={hub.newest} />
              <Row title={t("portals.hub.popular")} icon="👥" portals={hub.popular} />
            </>
          )}

          {nothing && (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
              <div className="mb-2"><Icon emoji="🧭" size={32} /></div>
              <p className="text-sm text-neutral-500">{t("portals.empty")}</p>
              <Link href="/tweets/create" className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                {t("portals.hub.startTagging")}
              </Link>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-neutral-900 dark:text-neutral-100">
              <Icon emoji="🗂️" size={18} /> {t("portals.hub.browseAll")}
            </h2>
            <PortalDirectory initial={directoryInitial} showSearch={false} />
          </section>

          <p className="rounded-xl bg-neutral-100 p-3 text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">{t("portals.hub.howItWorks")}</p>
        </>
      )}
    </div>
  );
}
