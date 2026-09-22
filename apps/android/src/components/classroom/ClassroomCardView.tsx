/**
 * apps/android/src/components/classroom/ClassroomCardView.tsx
 *
 * Classroom card for the Discover directory and the creator listing —
 * mirrors apps/web/components/classroom/ClassroomCard.tsx.
 */

import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ClassroomCard } from '@/lib/classroom/api';

export function ClassroomCardView({ classroom, actions }: { classroom: ClassroomCard; actions?: ReactNode }) {
  const { t } = useTranslation();
  const pill = 'rounded-full px-2 py-0.5 text-[11px] font-semibold';
  return (
    <div className="rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
      <Link to="/classroom/$roomId" params={{ roomId: classroom.id }} className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-2xl">{classroom.coverEmoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1">
            {classroom.category && <span className={`${pill} bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300`}>{classroom.category}</span>}
            {classroom.isPromoted && <span className={`${pill} bg-amber-100 text-amber-700`}>{t('classroom.card.promoted', 'Promoted')}</span>}
            {classroom.isOwner && !classroom.showInCreatorListing && <span className={`${pill} bg-neutral-200 text-neutral-600`}>{t('classroom.card.hiddenFromListing', 'Hidden from listing')}</span>}
            {!classroom.isActive && <span className={`${pill} bg-danger-100 text-danger-700`}>{t('classroom.card.archived', 'Archived')}</span>}
          </div>
          <h3 className="mt-1 truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{classroom.name}</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('classroom.card.by', 'By {{name}}', { name: classroom.creatorDisplayName })}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
            {classroom.enrolmentFeeNgn > 0 ? t('classroom.card.fee', '{{amount}} Credits', { amount: classroom.enrolmentFeeNgn.toLocaleString() }) : t('classroom.card.free', 'Free')}
          </p>
          {classroom.isEnrolled && <span className={`${pill} bg-teal-100 text-teal-700`}>{t('classroom.card.enrolled', 'Enrolled')}</span>}
        </div>
      </Link>
      {classroom.description && <p className="mt-2 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">{classroom.description}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t('classroom.card.members', '{{count}} members', { count: classroom.memberCount })} · {t('classroom.card.lessonCount', '{{count}} lessons', { count: classroom.lessonCount })}
        </p>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
