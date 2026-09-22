"use client";

/**
 * components/classroom/ClassroomCard.tsx
 *
 * Card for the shared ClassroomCard payload (lib/classroom/directory.ts) —
 * used by the Browse directory and the "Classrooms by @creator" listing.
 * Links to the classroom homepage at /c/<slug>. `actions` renders extra
 * owner controls (Boost/Share/Manage) in the footer.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ClassroomCard as ClassroomCardData } from "@/lib/classroom/directory";

export function ClassroomCard({ classroom, actions }: { classroom: ClassroomCardData; actions?: ReactNode }) {
  const { t } = useTranslation();
  const href = `/c/${classroom.slug ?? classroom.id}`;
  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <Link href={href} className="flex items-start gap-3">
        {classroom.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={classroom.coverImageUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 text-3xl dark:bg-violet-950">
            {classroom.coverEmoji}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {classroom.category && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {classroom.category}
              </span>
            )}
            {classroom.isPromoted && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {t("classroom.card.promoted", "Promoted")}
              </span>
            )}
            {classroom.isOwner && !classroom.showInCreatorListing && (
              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                {t("classroom.card.hiddenFromListing", "Hidden from listing")}
              </span>
            )}
            {!classroom.isActive && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {t("classroom.card.archived", "Archived")}
              </span>
            )}
          </div>
          <h3 className="mt-1 truncate text-base font-semibold text-neutral-900 dark:text-neutral-50">{classroom.name}</h3>
          <p className="text-xs text-neutral-500">
            {t("classroom.card.by", "By {{name}}", { name: classroom.creatorDisplayName })}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50">
            {classroom.enrolmentFeeNgn > 0
              ? t("classroom.card.fee", "{{amount}} Credits", { amount: classroom.enrolmentFeeNgn.toLocaleString() })
              : t("classroom.card.free", "Free")}
          </p>
          {classroom.isEnrolled && (
            <span className="mt-1 inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
              {t("classroom.card.enrolled", "Enrolled")}
            </span>
          )}
        </div>
      </Link>
      {classroom.description && (
        <p className="mt-2 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">{classroom.description}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          {t("classroom.card.members", "{{count}} members", { count: classroom.memberCount })}
          {" · "}
          {t("classroom.card.lessonCount", "{{count}} lessons", { count: classroom.lessonCount })}
        </p>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
