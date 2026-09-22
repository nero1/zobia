"use client";

/**
 * components/classroom/LeaderboardPanel.tsx
 *
 * This classroom's own gamification: the viewer's level + progress, the
 * points leaderboard (7 days / 30 days / all time), the level ladder with
 * the creator's custom level names, and badges. Scoped to the classroom —
 * none of this is visible platform-wide.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { classroomApi } from "@/lib/classroom/clientApi";
import type { ClassroomBadgeDef, ClassroomLeaderboardEntry, LeaderboardPeriod, MemberStanding } from "@/components/classroom/types";

interface LeaderboardData {
  period: LeaderboardPeriod;
  entries: ClassroomLeaderboardEntry[];
  me: MemberStanding;
  levels: Array<{ level: number; name: string; minPoints: number }>;
  badgeCatalog: ClassroomBadgeDef[];
}

export function LeaderboardPanel({ roomId, viewerId }: { roomId: string; viewerId: string | null }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<LeaderboardPeriod>("30d");
  const board = useQuery({
    queryKey: ["classroom", roomId, "leaderboard", period],
    queryFn: () => classroomApi<LeaderboardData>(`/${roomId}/leaderboard?period=${period}`),
  });

  const data = board.data;
  const earned = new Set(data?.me.badges.map((b) => b.key) ?? []);
  const levelName = (level: number) => data?.levels.find((l) => l.level === level)?.name ?? String(level);

  return (
    <div className="space-y-4">
      {data && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.leaderboard.yourLevel", "Your level")}</p>
              <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                {t("classroom.level.full", "Level {{level}} · {{name}}", { level: data.me.level, name: levelName(data.me.level) })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-violet-600">{t("classroom.points.count", "{{count}} pts", { count: data.me.points })}</p>
              {data.me.rank && <p className="text-xs text-neutral-500">{t("classroom.leaderboard.rank", "Rank #{{rank}}", { rank: data.me.rank })}</p>}
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${data.me.percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {data.me.pointsToNextLevel === null
              ? t("classroom.leaderboard.maxLevel", "Top level reached — legend!")
              : t("classroom.leaderboard.toNext", "{{points}} points to level {{level}}", { points: data.me.pointsToNextLevel, level: data.me.level + 1 })}
          </p>
          <p className="mt-2 text-[11px] text-neutral-400">
            {t("classroom.leaderboard.howToEarn", "Earn points when others like your posts and comments, and by completing lessons and passing quizzes.")}
          </p>
        </div>
      )}

      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        {(["7d", "30d", "all"] as LeaderboardPeriod[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${period === p ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-800 dark:text-neutral-50" : "text-neutral-500"}`}
          >
            {t(`classroom.leaderboard.period.${p}`, p === "7d" ? "7 days" : p === "30d" ? "30 days" : "All time")}
          </button>
        ))}
      </div>

      {board.isPending ? (
        <div className="h-40 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />
      ) : !data || data.entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">{t("classroom.leaderboard.empty", "No points earned in this period yet.")}</p>
      ) : (
        <ol className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {data.entries.map((e) => (
            <li key={e.userId} className={`flex items-center gap-3 px-4 py-2.5 ${e.userId === viewerId ? "bg-violet-50 dark:bg-violet-950/30" : ""}`}>
              <span className="w-7 text-center text-sm font-bold text-neutral-400">{e.rank <= 3 ? ["🥇", "🥈", "🥉"][e.rank - 1] : `#${e.rank}`}</span>
              <span className="text-xl">{e.avatarEmoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{e.displayName}</span>
                <span className="block text-[11px] text-neutral-500">{t("classroom.level.full", "Level {{level}} · {{name}}", { level: e.level, name: levelName(e.level) })}</span>
              </span>
              <span className="text-sm font-bold text-violet-600">{period === "all" ? e.points : `+${e.points}`}</span>
            </li>
          ))}
        </ol>
      )}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.leaderboard.levels", "Levels")}</h3>
            <ul className="mt-2 space-y-1">
              {data.levels.map((l) => (
                <li key={l.level} className={`flex justify-between text-sm ${l.level === data.me.level ? "font-bold text-violet-600" : "text-neutral-600 dark:text-neutral-300"}`}>
                  <span>
                    {l.level}. {l.name}
                  </span>
                  <span className="tabular-nums text-neutral-400">{l.minPoints}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.leaderboard.badges", "Badges")}</h3>
            <ul className="mt-2 grid grid-cols-1 gap-1.5">
              {data.badgeCatalog.map((b) => (
                <li key={b.key} className={`flex items-center gap-2 text-sm ${earned.has(b.key) ? "" : "opacity-40 grayscale"}`} title={t(`classroom.badges.${b.key}.description`, b.description)}>
                  <span className="text-lg">{b.emoji}</span>
                  <span className="text-neutral-700 dark:text-neutral-300">{t(`classroom.badges.${b.key}.name`, b.name)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
