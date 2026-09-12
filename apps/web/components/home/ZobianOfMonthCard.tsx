"use client";

/**
 * components/home/ZobianOfMonthCard.tsx
 *
 * "Zobian of the Month" spotlight card for the Home Dashboard's logo tab.
 * Fetches GET /api/feed/zobian-of-month (see lib/feed/zobianOfMonth.ts for
 * the response shape) and styles itself in the same celebratory
 * "spotlight" visual language as CreatorSpotlight (amber badge, avatar +
 * name treatment) for a consistent tone across the app's two "featured
 * person" widgets.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface ZobianOfMonth {
  month: string;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  score: string | null;
  isAdminOverride: boolean;
  note: string | null;
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  if (!year || !month) return monthStr;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function Skeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-amber-200 bg-white p-5 shadow-sm dark:border-amber-900 dark:bg-neutral-900">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>
    </div>
  );
}

export function ZobianOfMonthCard() {
  const { t } = useTranslation();
  const [data, setData] = useState<ZobianOfMonth | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/feed/zobian-of-month", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { zobianOfMonth?: ZobianOfMonth | null } } | null) => {
        setData(json?.data?.zobianOfMonth ?? null);
      })
      .catch(() => setData(null));
  }, []);

  if (data === undefined) return <Skeleton />;
  if (!data) return null;

  return (
    <Link
      href={`/profile/${data.userId}`}
      className="block rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm transition-colors hover:border-amber-300 dark:border-amber-900 dark:from-amber-950/20 dark:to-neutral-900 dark:hover:border-amber-800"
    >
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
        <svg className="h-3 w-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
        {t("home.zobianOfMonth.badge", { month: formatMonth(data.month) })}
      </span>
      <div className="mt-3 flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-amber-100 text-3xl ring-2 ring-amber-300 dark:bg-amber-900/40 dark:ring-amber-700">
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            data.avatarEmoji || "🌟"
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-neutral-900 dark:text-neutral-50">{data.displayName}</p>
          <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">@{data.username}</p>
          {data.score && (
            <p className="mt-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
              {t("home.zobianOfMonth.score", { score: data.score })}
            </p>
          )}
        </div>
      </div>
      {data.note && (
        <p className="mt-3 text-xs italic text-neutral-500 dark:text-neutral-400">&ldquo;{data.note}&rdquo;</p>
      )}
    </Link>
  );
}
