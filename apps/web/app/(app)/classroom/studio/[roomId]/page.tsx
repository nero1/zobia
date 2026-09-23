"use client";

/**
 * app/(app)/classroom/studio/[roomId]/page.tsx
 *
 * Per-classroom creator panel (and moderator panel). Tabs:
 *   Stats · Lessons · Members & moderators · Reports · Sessions · URL · Settings
 * Creators see everything; moderators see only the tabs their permissions
 * (classroom_settings.moderatorPermissions) allow. Every action is
 * re-authorized server-side (lib/classroom/access.ts).
 */

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import { BoostContentButton } from "@/components/ads/BoostContentButton";
import { ClassroomShareButton } from "@/components/classroom/ClassroomShareButton";
import { EventsPanel } from "@/components/classroom/EventsPanel";
import { QuizzesPanel } from "@/components/classroom/QuizzesPanel";
import { StatsPanel } from "@/components/classroom/studio/StatsPanel";
import { PublishBar } from "@/components/classroom/studio/PublishBar";
import { SettingsPanel } from "@/components/classroom/studio/SettingsPanel";
import { SlugPanel } from "@/components/classroom/studio/SlugPanel";
import { MembersPanel } from "@/components/classroom/studio/MembersPanel";
import { ReportsPanel } from "@/components/classroom/studio/ReportsPanel";
import { CurriculumPanel } from "@/components/classroom/studio/CurriculumPanel";
import type { ClassroomHomePayload } from "@/components/classroom/types";

type Tab = "stats" | "lessons" | "members" | "reports" | "sessions" | "url" | "settings";

export default function ClassroomStudioDetailPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const { t } = useTranslation();
  const home = useQuery({ queryKey: ["classroom", roomId, "home"], queryFn: () => classroomApi<ClassroomHomePayload>(`/${roomId}`) });

  const data = home.data;
  const can = data?.viewer.can;
  const tabs = useMemo(() => {
    if (!can) return [] as Array<{ key: Tab; label: string }>;
    const all: Array<{ key: Tab; label: string; show: boolean }> = [
      { key: "stats", label: t("classroom.studio.tabs.stats", "Stats"), show: can.manageClassroom },
      { key: "lessons", label: t("classroom.studio.tabs.lessons", "Lessons"), show: can.manageClassroom },
      { key: "members", label: t("classroom.studio.tabs.members", "Members & moderators"), show: can.manageClassroom || can.manageMembers },
      { key: "reports", label: t("classroom.studio.tabs.reports", "Reports"), show: can.handleReports },
      { key: "sessions", label: t("classroom.studio.tabs.sessions", "Live sessions"), show: can.manageEvents },
      { key: "url", label: t("classroom.studio.tabs.url", "URL"), show: can.manageClassroom },
      { key: "settings", label: t("classroom.studio.tabs.settings", "Settings"), show: can.manageClassroom },
    ];
    return all.filter((x) => x.show);
  }, [can, t]);
  const [tab, setTab] = useState<Tab | null>(null);
  const active = tab ?? tabs[0]?.key ?? null;

  const levelName = useMemo(() => {
    const m = new Map((data?.classroom.levels ?? []).map((l) => [l.level, l.name]));
    return (level: number) => m.get(level) ?? String(level);
  }, [data?.classroom.levels]);

  if (home.isPending) return <div className="mx-auto max-w-5xl p-6"><div className="h-40 animate-pulse rounded-xl bg-white dark:bg-neutral-900" /></div>;
  if (home.isError || !data) {
    const err = home.error as ClassroomApiError | null;
    return <p className="m-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err ? translateApiError(t, err.code, err.message) : t("classroom.error.loadFailed", "Failed to load classrooms")}</p>;
  }
  if (tabs.length === 0) {
    return <p className="m-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t("classroom.studio.noAccess", "You don't have management access to this classroom.")}</p>;
  }
  const c = data.classroom;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <Link href="/classroom/studio" className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        ← {t("classroom.nav.studio", "Classroom Studio")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{c.coverEmoji}</span>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{c.name}</h1>
            <Link href={`/c/${c.slug ?? c.id}`} className="text-sm text-violet-600 hover:underline dark:text-violet-400">
              /c/{c.slug ?? c.id} ↗
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ClassroomShareButton roomId={c.id} slug={c.slug} name={c.name} />
          {data.viewer.can.manageClassroom && <BoostContentButton contentType="classroom" contentId={c.id} title={c.name} imageUrl={c.coverImageUrl} />}
        </div>
      </div>

      {data.viewer.can.manageClassroom && <PublishBar home={data} />}

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex-shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${active === tb.key ? "bg-violet-600 text-white" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}
          >
            {tb.label}
          </button>
        ))}
      </nav>

      {active === "stats" && <StatsPanel roomId={c.id} />}
      {active === "lessons" && (
        <div className="space-y-5">
          <CurriculumPanel home={data} levelName={levelName} />
          <QuizzesPanel roomId={c.id} canTake={false} canManage />
        </div>
      )}
      {active === "members" && <MembersPanel home={data} />}
      {active === "reports" && <ReportsPanel roomId={c.id} />}
      {active === "sessions" && <EventsPanel roomId={c.id} canManage isMember />}
      {active === "url" && <SlugPanel home={data} />}
      {active === "settings" && data.settings && <SettingsPanel home={data} />}
    </div>
  );
}
