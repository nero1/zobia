"use client";

/**
 * app/(app)/classroom/studio/page.tsx
 *
 * Classroom Creator Studio — the aggregate view across every classroom the
 * caller created (GET /api/classroom/studio): revenue today/7d/30d/all-time,
 * members, pending reports, a per-classroom table with management actions
 * (manage, share, boost, archive/reactivate, delete) and — detailed stats
 * tier — a 30-day revenue chart. Earnings are withdrawn through the shared
 * CreatorPayoutPanel (the existing /api/creator/payouts pipeline).
 */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError, formatNgnKobo } from "@/lib/classroom/clientApi";
import { BoostContentButton } from "@/components/ads/BoostContentButton";
import { ClassroomShareButton } from "@/components/classroom/ClassroomShareButton";
import { CreatorPayoutPanel } from "@/components/creator/CreatorPayoutPanel";
import { DailyBars } from "@/components/classroom/DailyBars";
import { StatsTierNote } from "@/components/classroom/StatsTierNote";
import type { StudioClassroomRow, StudioSummary } from "@/components/classroom/types";

type StudioData = StudioSummary & {
  username: string | null;
  plan: string;
  creatorTier: string | null;
  canWithdraw: boolean;
  availableEarningsKobo: number;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{value}</p>
    </div>
  );
}

export default function ClassroomStudioPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; kind: "success" | "error" } | null>(null);
  const showToast = (msg: string, kind: "success" | "error") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };

  const studio = useQuery({ queryKey: ["classroom", "studio"], queryFn: () => classroomApi<StudioData>("/studio") });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["classroom", "studio"] });
  const onErr = (e: unknown) => showToast(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message), "error");

  const setActive = useMutation({
    mutationFn: (c: StudioClassroomRow) => classroomApi(`/${c.id}`, { method: "PATCH", body: { isActive: !c.isActive } }),
    onSuccess: refresh,
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (c: StudioClassroomRow) => classroomApi(`/${c.id}`, { method: "DELETE" }),
    onSuccess: () => {
      showToast(t("classroom.studio.deleted", "Classroom deleted"), "success");
      refresh();
    },
    onError: onErr,
  });

  if (studio.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />
          ))}
        </div>
      </div>
    );
  }
  if (studio.isError) {
    const err = studio.error as ClassroomApiError;
    return <p className="m-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{translateApiError(t, err.code, err.message)}</p>;
  }
  const data = studio.data;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.kind === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("classroom.nav.studio", "Classroom Studio")}</h1>
          <p className="text-sm text-neutral-500">{t("classroom.studio.subtitle", "Everything across all of your classrooms.")}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {data.username && (
            <Link href={`/classroom/by/${data.username}`} className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
              {t("classroom.nav.myClassrooms", "My Classrooms")}
            </Link>
          )}
          <Link href="/classroom/new" className="rounded-full bg-violet-600 px-3 py-1.5 font-semibold text-white hover:bg-violet-700">
            {t("classroom.nav.create", "+ New Classroom")}
          </Link>
        </div>
      </div>

      <StatsTierNote tier={data.tier} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("classroom.studio.revenueToday", "Revenue today")} value={formatNgnKobo(data.totals.revenueTodayKobo)} />
        <Stat label={t("classroom.studio.revenueWeek", "Last 7 days")} value={formatNgnKobo(data.totals.revenueWeekKobo)} />
        <Stat label={t("classroom.studio.revenueMonth", "Last 30 days")} value={formatNgnKobo(data.totals.revenueMonthKobo)} />
        <Stat label={t("classroom.studio.revenueAll", "All time")} value={formatNgnKobo(data.totals.revenueAllTimeKobo)} />
        <Stat label={t("classroom.studio.classrooms", "Classrooms")} value={`${data.totals.activeClassrooms} / ${data.totals.classrooms}`} />
        <Stat label={t("classroom.studio.members", "Members")} value={data.totals.members} />
        <Stat label={t("classroom.studio.paidMembers", "Paid members")} value={data.totals.paidMembers} />
        <Stat label={t("classroom.studio.pendingReports", "Pending reports")} value={data.totals.pendingReports} />
      </div>

      {data.daily && (
        <DailyBars
          label={t("classroom.studio.dailyRevenue", "Classroom revenue — last 30 days")}
          points={data.daily.map((d) => ({ day: d.day, value: d.revenueKobo }))}
          format={formatNgnKobo}
        />
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.studio.yourClassrooms", "Your classrooms")}</h2>
        {data.classrooms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
            {t("classroom.listing.emptyOwner", "You haven't created a classroom yet.")}
          </div>
        ) : (
          <div className="space-y-2">
            {data.classrooms.map((c) => (
              <div key={c.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link href={`/c/${c.slug ?? c.id}`} className="flex min-w-0 items-center gap-3">
                    <span className="text-3xl">{c.coverEmoji}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-neutral-900 dark:text-neutral-50">{c.name}</span>
                      <span className="block text-xs text-neutral-500">
                        /c/{c.slug ?? c.id}
                        {!c.isActive && ` · ${t("classroom.card.archived", "Archived")}`}
                        {!c.isPublic && ` · ${t("classroom.home.private", "Private")}`}
                        {!c.showInCreatorListing && ` · ${t("classroom.card.hiddenFromListing", "Hidden from listing")}`}
                      </span>
                    </span>
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/classroom/studio/${c.id}`} className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-700">
                      ⚙️ {t("classroom.home.manage", "Manage")}
                    </Link>
                    <ClassroomShareButton roomId={c.id} slug={c.slug} name={c.name} />
                    <BoostContentButton contentType="classroom" contentId={c.id} title={c.name} />
                    <button
                      type="button"
                      onClick={() => setActive.mutate(c)}
                      className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {c.isActive ? t("classroom.studio.archive", "Archive") : t("classroom.studio.reactivate", "Reactivate")}
                    </button>
                    {c.paidMembers === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(t("classroom.studio.deleteConfirm", "Delete this classroom permanently? Members lose access."))) remove.mutate(c);
                        }}
                        className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                      >
                        {t("classroom.feed.delete", "Delete")}
                      </button>
                    )}
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
                  {[
                    [t("classroom.studio.members", "Members"), c.members],
                    [t("classroom.studio.paidMembers", "Paid members"), c.paidMembers],
                    [t("classroom.studio.revenueAll", "All time"), formatNgnKobo(c.revenueAllTimeKobo)],
                    [t("classroom.studio.revenueMonth", "Last 30 days"), formatNgnKobo(c.revenue30dKobo)],
                    [t("classroom.studio.active7d", "Active (7d)"), c.activeMembers7d],
                    [t("classroom.studio.pendingReports", "Pending reports"), c.pendingReports],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt className="text-neutral-500">{k}</dt>
                      <dd className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <CreatorPayoutPanel
        title={t("classroom.studio.earnings", "Earnings & withdrawals")}
        onToast={showToast}
        notCreatorHint={t(
          "classroom.studio.notCreator",
          "Classroom revenue is added to your creator balance. Withdrawals unlock once your account has creator status."
        )}
      />
    </div>
  );
}
