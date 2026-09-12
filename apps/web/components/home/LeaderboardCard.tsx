"use client";

/**
 * components/home/LeaderboardCard.tsx
 *
 * Relocated, unchanged-behavior leaderboard position card — was inline in
 * app/(app)/home/page.tsx. Fetches rank from GET /api/leaderboards/me and
 * XP from GET /api/users/me, same as before.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface LeaderboardPosition {
  rank: number;
  rankDelta: number;
  xp: number;
}

function LeaderboardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 h-4 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mb-1 h-8 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

export function LeaderboardCard() {
  const { t } = useTranslation();
  const [position, setPosition] = useState<LeaderboardPosition | null | undefined>(undefined);

  useEffect(() => {
    Promise.all([
      fetch("/api/leaderboards/me", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/users/me", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([lbData, meData]) => {
      const ranks: Array<{ track: string; globalRank: number | null }> = lbData?.data?.ranks ?? [];
      const mainRank = ranks.find((r) => r.track === "main");
      const me = meData?.user ?? meData;
      const xp = me?.xp_total ?? 0;
      if (mainRank?.globalRank != null) {
        setPosition({ rank: mainRank.globalRank, rankDelta: 0, xp });
      } else {
        setPosition(null);
      }
    }).catch(() => setPosition(null));
  }, []);

  if (position === undefined) return <LeaderboardSkeleton />;
  if (!position) return null;

  const delta = position.rankDelta;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("home.leaderboard.title")}</h2>
      <div className="flex items-end gap-2">
        <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">#{position.rank.toLocaleString()}</p>
        {delta !== 0 ? (
          <span className={`mb-1 text-sm font-semibold ${delta > 0 ? "text-teal-600" : "text-red-500"}`}>
            {delta > 0 ? `+${delta}` : delta} {t("home.leaderboard.today")}
          </span>
        ) : (
          <span className="mb-1 text-sm text-neutral-400">{t("home.leaderboard.noChange")}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-400">{t("home.leaderboard.totalXp", { xp: position.xp.toLocaleString() })}</p>
      <Link href="/leaderboards" className="mt-3 block text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
        {t("home.leaderboard.viewFull")}
      </Link>
    </div>
  );
}
