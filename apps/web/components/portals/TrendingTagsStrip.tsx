"use client";

/**
 * components/portals/TrendingTagsStrip.tsx
 *
 * A slim row of trending hashtags (and a link to the /h hub) shown above the
 * For You feed. Reads the same cached public payload as the hub
 * (GET /api/public/portals/discover); the response is kept in sessionStorage
 * for 10 minutes so switching tabs or pages never refetches. Public data, so
 * the storage key is intentionally not user scoped. Renders nothing when the
 * feature is off, the request fails or there is no trend yet.
 */

import Link from "@/components/ui/Link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { portalPath } from "@zobia/shared/utils";
import type { PortalDiscover, TrendingTag } from "@zobia/types";

const KEY = "zobia:portals:trending-strip:v1";
const TTL_MS = 10 * 60 * 1000;

function readCache(): TrendingTag[] | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; tags: TrendingTag[] };
    return Date.now() - parsed.at < TTL_MS ? parsed.tags : null;
  } catch {
    return null;
  }
}

export function TrendingTagsStrip() {
  const { t } = useTranslation();
  const [tags, setTags] = useState<TrendingTag[]>([]);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setTags(cached);
      return;
    }
    let cancelled = false;
    fetch("/api/public/portals/discover")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const list = ((json?.data as PortalDiscover | undefined)?.trendingTags ?? []).slice(0, 10);
        if (cancelled) return;
        setTags(list);
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), tags: list }));
        } catch {
          /* best-effort */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (tags.length === 0) return null;
  return (
    <nav aria-label={t("portals.hub.trendingTags")} className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
      <Link href="/h" className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
        <Icon emoji="🧭" size={12} /> {t("portals.title")}
      </Link>
      {tags.map((tg) => (
        <Link
          key={tg.slug}
          href={portalPath(tg.slug)}
          className="shrink-0 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          #{tg.slug}
        </Link>
      ))}
    </nav>
  );
}
