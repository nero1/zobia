"use client";

/**
 * components/home/FeedItemCard.tsx
 *
 * One Home Feed card, content-type-agnostic per lib/feed/types.ts FeedItem.
 * Renders title/excerpt/image/relative-time and a click-through to the
 * item's deep link (FeedItem.url, computed server-side by
 * lib/feed/deeplink.ts).
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { deepLinkPathFor } from "@/lib/feed/deeplink";
import type { FeedContentType } from "@/lib/feed/types";

export interface FeedItemView {
  contentType: FeedContentType;
  contentId: string;
  authorId: string | null;
  title: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  url: string;
  createdAt: string;
  isBoosted: boolean;
  isInHouseBoosted: boolean;
  metrics?: Record<string, number>;
}

const CONTENT_TYPE_ICON: Record<FeedContentType, string> = {
  moment: "⚡",
  tweet: "🐦",
  blog_post: "✍️",
  forum_thread: "🗨️",
  forum_question: "❓",
  room: "🚪",
  wiki_page: "📖",
  game: "🎮",
  classroom: "🏫",
  business_page_post: "🏢",
  poll: "🗳️",
  quiz: "🧠",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function FeedItemCard({ item }: { item: FeedItemView }) {
  const { t } = useTranslation();
  const metricEntries = item.metrics ? Object.entries(item.metrics).slice(0, 3) : [];
  // `url` is typed as string but arrives over the wire — a server-side
  // undefined is dropped entirely by JSON.stringify, so the field can be
  // absent here. Next's <Link> throws from inside formatUrl() on an
  // undefined href (see lib/feed/deeplink.ts), so recompute rather than
  // trust the payload.
  const href = typeof item.url === "string" && item.url ? item.url : deepLinkPathFor(item.contentType, item.contentId);

  return (
    <Link
      href={href}
      className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
    >
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-2xl dark:bg-neutral-800">
          {CONTENT_TYPE_ICON[item.contentType] ?? "📄"}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            {t(`feedTabs.contentType.${item.contentType}`)}
          </span>
          {(item.isBoosted || item.isInHouseBoosted) && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
              {t("feedTabs.sponsored")}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-neutral-400">{timeAgo(item.createdAt)}</span>
        </div>
        {item.title && (
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</p>
        )}
        {item.excerpt && (
          <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{item.excerpt}</p>
        )}
        {metricEntries.length > 0 && (
          <div className="mt-1.5 flex gap-3 text-[11px] text-neutral-400">
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
    <div className="flex animate-pulse gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="h-16 w-16 shrink-0 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
      </div>
    </div>
  );
}
