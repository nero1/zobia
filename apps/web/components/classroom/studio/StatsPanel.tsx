"use client";

/**
 * components/classroom/studio/StatsPanel.tsx
 *
 * Per-classroom analytics (GET /api/classroom/:id/stats). What renders
 * depends on the stats tier the server resolved from the creator's plan +
 * creator tier: basic totals → activity/completion rates → daily chart,
 * lesson funnel, top contributors and view→enrolment conversion.
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { classroomApi, formatNgnKobo } from "@/lib/classroom/clientApi";
import { DailyBars } from "@/components/classroom/DailyBars";
import { StatsTierNote } from "@/components/classroom/StatsTierNote";
import type { ClassroomStats } from "@/components/classroom/types";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{value}</p>
    </div>
  );
}

export function StatsPanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const stats = useQuery({ queryKey: ["classroom", roomId, "stats"], queryFn: () => classroomApi<ClassroomStats>(`/${roomId}/stats`) });

  if (stats.isPending) return <div className="h-40 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />;
  if (!stats.data) return <p className="text-sm text-red-600">{t("classroom.error.loadFailed", "Failed to load classrooms")}</p>;
  const { basic, more, detailed, tier } = stats.data;

  return (
    <div className="space-y-4">
      <StatsTierNote tier={tier} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("classroom.studio.members", "Members")} value={basic.members} />
        <Stat label={t("classroom.studio.paidMembers", "Paid members")} value={basic.paidMembers} />
        <Stat label={t("classroom.studio.revenueAll", "All time")} value={formatNgnKobo(basic.revenueAllTimeKobo)} />
        <Stat label={t("classroom.stats.posts", "Posts")} value={basic.posts} />
        <Stat label={t("classroom.home.lessons", "Lessons")} value={basic.lessons} />
        <Stat label={t("classroom.stats.upcomingSessions", "Upcoming sessions")} value={basic.upcomingEvents} />
        <Stat label={t("classroom.home.moderators", "Moderators")} value={basic.moderators} />
      </div>

      {more && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("classroom.stats.new7d", "New members (7d)")} value={more.newMembers7d} />
          <Stat label={t("classroom.stats.new30d", "New members (30d)")} value={more.newMembers30d} />
          <Stat label={t("classroom.studio.active7d", "Active (7d)")} value={more.activeMembers7d} />
          <Stat label={t("classroom.studio.revenueMonth", "Last 30 days")} value={formatNgnKobo(more.revenue30dKobo)} />
          <Stat label={t("classroom.stats.comments", "Comments")} value={more.comments} />
          <Stat label={t("classroom.stats.likes", "Likes")} value={more.likes} />
          <Stat label={t("classroom.stats.completionRate", "Lesson completion")} value={`${more.lessonCompletionRate}%`} />
          <Stat label={t("classroom.stats.courseCompletions", "Course completions")} value={more.courseCompletions} />
          <Stat label={t("classroom.stats.quizPassRate", "Quiz pass rate")} value={`${more.quizPassRate}% (${more.quizAttempts})`} />
          <Stat label={t("classroom.stats.shares", "Shares")} value={more.shares} />
          <Stat label={t("classroom.stats.views30d", "Page views (30d)")} value={more.pageViews30d} />
        </div>
      )}

      {detailed && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <DailyBars
              label={t("classroom.stats.dailyEnrolments", "Enrolments — last 30 days")}
              points={detailed.daily.map((d) => ({ day: d.day, value: d.enrolments }))}
              format={(v) => String(v)}
            />
            <DailyBars
              label={t("classroom.stats.dailyViews", "Page views — last 30 days")}
              points={detailed.daily.map((d) => ({ day: d.day, value: d.pageViews }))}
              format={(v) => String(v)}
            />
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {detailed.viewToEnrolmentRate === null
              ? t("classroom.stats.noConversion", "No page views in the last 30 days yet.")
              : t("classroom.stats.conversion", "View → enrolment conversion (30d): {{rate}}%", { rate: detailed.viewToEnrolmentRate })}
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.stats.lessonFunnel", "Lesson funnel")}</h3>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {detailed.lessonFunnel.map((l, i) => (
                    <tr key={l.moduleId} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1.5 pr-2 text-neutral-700 dark:text-neutral-300">
                        {i + 1}. {l.title}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-neutral-900 dark:text-neutral-100">{l.completions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.stats.topContributors", "Top contributors (30d)")}</h3>
              <ol className="mt-2 space-y-1 text-sm">
                {detailed.topContributors.length === 0 && <li className="text-neutral-500">—</li>}
                {detailed.topContributors.map((c) => (
                  <li key={c.userId} className="flex justify-between">
                    <span className="text-neutral-700 dark:text-neutral-300">
                      #{c.rank} {c.avatarEmoji} @{c.username}
                    </span>
                    <span className="tabular-nums font-semibold text-violet-600">+{c.points}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
