"use client";

/**
 * components/classroom/ClassroomHome.tsx
 *
 * Interactive classroom homepage rendered by /c/<slug>. Receives the
 * server-built, role-filtered payload as `initial` (so first paint and SEO
 * need no client fetch) and keeps it fresh through React Query for signed-in
 * viewers (persisted per user by lib/offline/queryPersist.ts).
 *
 * Tabs: Community · Classroom (lessons) · Calendar (live sessions +
 * recordings) · Leaderboard · About. Header actions: Enrol, Share, Boost
 * (creator) and Manage (creator/moderators → Creator Studio).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { classroomApi } from "@/lib/classroom/clientApi";
import { BoostContentButton } from "@/components/ads/BoostContentButton";
import { ClassroomShareButton } from "@/components/classroom/ClassroomShareButton";
import { EnrollButton } from "@/components/classroom/EnrollButton";
import { CommunityFeed } from "@/components/classroom/CommunityFeed";
import { LessonsPanel } from "@/components/classroom/LessonsPanel";
import { QuizzesPanel } from "@/components/classroom/QuizzesPanel";
import { EventsPanel } from "@/components/classroom/EventsPanel";
import { LeaderboardPanel } from "@/components/classroom/LeaderboardPanel";
import type { ClassroomHomePayload } from "@/components/classroom/types";

type Tab = "community" | "classroom" | "calendar" | "leaderboard" | "about";

export function ClassroomHome({ initial, signedIn }: { initial: ClassroomHomePayload; signedIn: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const roomId = initial.classroom.id;

  const paymentComplete = searchParams?.get("payment") === "complete";
  // Bounded reconciliation: the enrolment is normally written by the Paystack
  // webhook, but that can be delayed or never arrive (wrong webhook URL,
  // signature mismatch, a 500 mid-handler). Poll for up to ~40s, and on each
  // tick also ask the server to actively re-verify the charge with Paystack
  // (idempotent — see /api/classroom/[roomId]/enroll/verify) so the
  // enrolment finalizes even if the webhook never lands, instead of polling
  // forever against data that will never change.
  const MAX_VERIFY_ATTEMPTS = 10;
  const [verifyAttempts, setVerifyAttempts] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [verifyFailed, setVerifyFailed] = useState(false);
  const verifyingRef = useRef(false);

  const homeQuery = useQuery({
    queryKey: ["classroom", roomId, "home"],
    queryFn: () => classroomApi<ClassroomHomePayload>(`/${roomId}`),
    initialData: initial,
    enabled: signedIn,
    refetchInterval: (q) =>
      paymentComplete && !q.state.data?.viewer.isEnrolled && verifyAttempts < MAX_VERIFY_ATTEMPTS ? 4000 : false,
  });
  const home = homeQuery.data ?? initial;
  const { classroom, viewer } = home;
  const insider = viewer.can.viewMemberContent;
  const canManageStudio = viewer.can.manageClassroom || viewer.isModerator;

  const runVerify = useCallback(async () => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);
    try {
      const result = await classroomApi<{ status: "completed" | "pending" | "failed" }>(
        `/${roomId}/enroll/verify`,
        { method: "POST" }
      );
      if (result.status === "completed") {
        await qc.invalidateQueries({ queryKey: ["classroom", roomId, "home"] });
      } else if (result.status === "failed") {
        setVerifyFailed(true);
      }
    } catch {
      // transient — the bounded poll below will retry
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
      setVerifyAttempts((n) => n + 1);
    }
  }, [roomId, qc]);

  useEffect(() => {
    if (!paymentComplete || viewer.isEnrolled || verifyFailed) return;
    if (verifyAttempts >= MAX_VERIFY_ATTEMPTS) return;
    const timer = setTimeout(() => void runVerify(), verifyAttempts === 0 ? 0 : 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentComplete, viewer.isEnrolled, verifyFailed, verifyAttempts]);

  const [tab, setTab] = useState<Tab>(insider ? "community" : "about");

  const levelName = useMemo(() => {
    const byLevel = new Map(classroom.levels.map((l) => [l.level, l.name]));
    return (level: number) => byLevel.get(level) ?? String(level);
  }, [classroom.levels]);

  const tabs: Array<{ key: Tab; label: string; locked: boolean }> = [
    { key: "community", label: t("classroom.home.tabs.community", "Community"), locked: !insider },
    { key: "classroom", label: t("classroom.home.tabs.classroom", "Classroom"), locked: false },
    { key: "calendar", label: t("classroom.home.tabs.calendar", "Calendar"), locked: false },
    { key: "leaderboard", label: t("classroom.home.tabs.leaderboard", "Leaderboard"), locked: !insider },
    { key: "about", label: t("classroom.home.tabs.about", "About"), locked: false },
  ];

  const refreshAll = () => void qc.invalidateQueries({ queryKey: ["classroom", roomId] });

  const lockedPrompt = (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <span className="text-4xl">🔒</span>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
        {t("classroom.home.membersOnly", "Enrol in this classroom to join the community, climb the leaderboard and access every lesson.")}
      </p>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <Link href="/classroom" className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        ← {t("classroom.home.back", "All classrooms")}
      </Link>

      {/* Header */}
      <header className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        {classroom.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={classroom.coverImageUrl} alt="" className="h-40 w-full object-cover sm:h-52" width={1200} height={208} />
        )}
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              {!classroom.coverImageUrl && <span className="text-4xl">{classroom.coverEmoji}</span>}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {classroom.category && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{classroom.category}</span>
                  )}
                  {!classroom.isPublic && (
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">{t("classroom.home.private", "Private")}</span>
                  )}
                  {!classroom.isActive && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">{t("classroom.card.archived", "Archived")}</span>
                  )}
                </div>
                <h1 className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{classroom.name}</h1>
                <p className="text-sm text-neutral-500">
                  {t("classroom.home.hostedBy", "Hosted by")}{" "}
                  <a href={`/u/${classroom.creator.username}`} className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                    @{classroom.creator.username}
                  </a>
                  {" · "}
                  {t("classroom.card.members", "{{count}} members", { count: classroom.memberCount })}
                  {" · "}
                  {classroom.enrolmentFeeNgn > 0
                    ? t("classroom.card.fee", "{{amount}} Credits", { amount: classroom.enrolmentFeeNgn.toLocaleString() })
                    : t("classroom.card.free", "Free")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!signedIn ? (
                <a
                  href={`/auth/login?redirect=${encodeURIComponent(`/c/${classroom.slug ?? classroom.id}`)}`}
                  className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                >
                  {t("classroom.home.signInToJoin", "Sign in to join")}
                </a>
              ) : !viewer.isEnrolled && !viewer.isCreator && classroom.isActive ? (
                <EnrollButton roomId={roomId} feeNgn={classroom.enrolmentFeeNgn} onEnrolled={refreshAll} />
              ) : viewer.isEnrolled ? (
                <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                  ✓ {t("classroom.card.enrolled", "Enrolled")}
                </span>
              ) : null}
              {insider && classroom.chatRoomEnabled && (
                <Link
                  href={`/rooms/${roomId}`}
                  className="rounded-xl bg-violet-100 px-3 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:hover:bg-violet-900/60"
                >
                  💬 {t("classroom.home.openRoom", "Open Room")}
                </Link>
              )}
              <ClassroomShareButton roomId={roomId} slug={classroom.slug} name={classroom.name} signedIn={signedIn} />
              {viewer.can.manageClassroom && <BoostContentButton contentType="classroom" contentId={roomId} title={classroom.name} imageUrl={classroom.coverImageUrl} />}
              {canManageStudio && (
                <Link
                  href={`/classroom/studio/${roomId}`}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  ⚙️ {t("classroom.home.manage", "Manage")}
                </Link>
              )}
            </div>
          </div>

          {paymentComplete && !viewer.isEnrolled && !verifyFailed && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              {verifyAttempts < MAX_VERIFY_ATTEMPTS ? (
                <p>{t("classroom.home.paymentPending", "Payment received — finishing your enrolment…")}</p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>{t("classroom.home.paymentPendingTimeout", "This is taking longer than expected.")}</p>
                  <button
                    type="button"
                    disabled={verifying}
                    onClick={() => {
                      setVerifyAttempts(0);
                    }}
                    className="rounded-lg bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                  >
                    {verifying ? t("classroom.home.checkingStatus", "Checking…") : t("classroom.home.checkStatus", "Check status")}
                  </button>
                </div>
              )}
            </div>
          )}
          {paymentComplete && verifyFailed && !viewer.isEnrolled && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {t(
                "classroom.home.paymentFailed",
                "We couldn't confirm this payment. If you were charged, please contact support — otherwise you can try enrolling again."
              )}
            </p>
          )}

          {insider && home.standing && (
            <div className="mt-4 rounded-xl bg-violet-50 p-3 dark:bg-violet-950/30">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-violet-800 dark:text-violet-200">
                  {t("classroom.level.full", "Level {{level}} · {{name}}", { level: home.standing.level, name: levelName(home.standing.level) })}
                </span>
                <span className="text-violet-700 dark:text-violet-300">{t("classroom.points.count", "{{count}} pts", { count: home.standing.points })}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-violet-200 dark:bg-violet-900">
                <div className="h-full rounded-full bg-violet-600" style={{ width: `${home.standing.percent}%` }} />
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900" aria-label={t("classroom.home.tabsLabel", "Classroom sections")}>
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex-shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${
              tab === tb.key ? "bg-violet-600 text-white" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {tb.label}
            {tb.locked && " 🔒"}
          </button>
        ))}
      </nav>

      {tab === "community" && (insider ? <CommunityFeed home={home} levelName={levelName} /> : lockedPrompt)}
      {tab === "classroom" && (
        <div className="space-y-5">
          <LessonsPanel home={home} levelName={levelName} />
          {insider && <QuizzesPanel roomId={roomId} canTake={viewer.isEnrolled} canManage={viewer.can.manageClassroom} />}
        </div>
      )}
      {tab === "calendar" &&
        (signedIn ? (
          <EventsPanel roomId={roomId} canManage={viewer.can.manageEvents} isMember={insider} />
        ) : home.upcomingEvents.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">{t("classroom.events.empty", "No live sessions scheduled yet.")}</p>
        ) : (
          <ul className="space-y-2">
            {home.upcomingEvents.map((e) => (
              <li key={e.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="font-semibold text-neutral-900 dark:text-neutral-50">{e.title}</p>
                <p className="text-xs text-neutral-500">{new Date(e.startsAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        ))}
      {tab === "leaderboard" && (insider ? <LeaderboardPanel roomId={roomId} viewerId={viewer.userId} /> : lockedPrompt)}
      {tab === "about" && (
        <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          {classroom.description ? (
            <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{classroom.description}</p>
          ) : (
            <p className="text-sm text-neutral-500">{t("classroom.home.noDescription", "The creator hasn't added a description yet.")}</p>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.home.lessons", "Lessons")}</dt>
              <dd className="text-neutral-900 dark:text-neutral-100">{home.modules.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.home.members", "Members")}</dt>
              <dd className="text-neutral-900 dark:text-neutral-100">{classroom.memberCount}</dd>
            </div>
            {(classroom.classStartDate || classroom.classEndDate) && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.home.dates", "Dates")}</dt>
                <dd className="text-neutral-900 dark:text-neutral-100">
                  {classroom.classStartDate ?? "…"} – {classroom.classEndDate ?? "…"}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.home.price", "Price")}</dt>
              <dd className="text-neutral-900 dark:text-neutral-100">
                {classroom.enrolmentFeeNgn > 0
                  ? t("classroom.card.fee", "{{amount}} Credits", { amount: classroom.enrolmentFeeNgn.toLocaleString() })
                  : t("classroom.card.free", "Free")}
              </dd>
            </div>
          </dl>
          {home.moderators.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.home.moderators", "Moderators")}</p>
              <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                {home.moderators.map((m) => `${m.avatarEmoji} @${m.username}`).join("  ·  ")}
              </p>
            </div>
          )}
          <Link href={`/classroom/by/${classroom.creator.username}`} className="inline-block text-sm font-medium text-violet-600 hover:underline dark:text-violet-400">
            {t("classroom.home.moreByCreator", "More classrooms by @{{username}} →", { username: classroom.creator.username })}
          </Link>
        </section>
      )}
    </div>
  );
}
