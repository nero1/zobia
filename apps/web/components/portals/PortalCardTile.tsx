"use client";

/**
 * components/portals/PortalCardTile.tsx
 *
 * One portal tile, shared by the feed suggestion card, the /h discovery page
 * and the "following" list. The accent colour (admin-set per portal) tints the
 * cover so every portal feels distinct without any per-portal assets.
 */

import Link from "@/components/ui/Link";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import { portalPath } from "@zobia/shared/utils";
import type { PortalCard } from "@zobia/types";

export function portalTileHref(portal: Pick<PortalCard, "slug">, src?: "feed" | "search"): string {
  return src ? `${portalPath(portal.slug)}?src=${src}` : portalPath(portal.slug);
}

export function PortalCardTile({ portal, src, className = "" }: { portal: PortalCard; src?: "feed" | "search"; className?: string }) {
  const { t } = useTranslation();
  const accent = portal.accentColor ?? "#0d9488";
  return (
    <Link
      href={portalTileHref(portal, src)}
      className={`group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700 ${className}`}
    >
      <div
        className="relative h-16 w-full bg-cover bg-center"
        style={portal.coverImageUrl ? { backgroundImage: `url(${portal.coverImageUrl})` } : { background: `linear-gradient(135deg, ${accent}, ${accent}99)` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        {(portal.isPromoted || portal.status === "official") && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-bold text-white">
            {portal.isPromoted ? t("portals.promoted") : <><Icon emoji="✓" size={10} /> {t("portals.official")}</>}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
        <p className="truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">
          <span style={{ color: accent }}>#</span>
          {portal.slug}
        </p>
        <p className="truncate text-xs font-medium text-neutral-600 dark:text-neutral-300">{portal.title}</p>
        {portal.tagline && <p className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{portal.tagline}</p>}
        <p className="mt-1 flex items-center gap-2 text-[11px] text-neutral-400">
          <span>{t("portals.followers", { count: portal.followerCount })}</span>
          {portal.activityCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Icon emoji="🔥" size={10} /> {t("portals.activeNow", { count: portal.activityCount })}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}
