/**
 * apps/android/src/routes/classroom/studio/index.tsx
 *
 * Classroom Studio summary — mirrors apps/web/app/(app)/classroom/studio/
 * page.tsx: revenue (today / 7d / 30d / all time), members, pending reports
 * and a per-classroom list with Manage / Share / Boost / archive. Classroom
 * revenue lands in the same creator balance as every other stream, so
 * withdrawing reuses the existing Creator Dashboard payout flow (/creator).
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiError, formatNgnKobo, get, send, type StudioRow, type StudioSummary } from '@/lib/classroom/api';
import { ClassroomBoostButton, ClassroomShareButton } from '@/components/classroom/ClassroomActions';
import { StatsTierNote } from '@/components/classroom/Studio';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white dark:bg-neutral-800 p-3">
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function StudioPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const studio = useQuery({ queryKey: ['classroom', 'studio'], queryFn: () => get<StudioSummary>('/studio') });
  const archive = useMutation({
    mutationFn: (c: StudioRow) => send('patch', `/${c.id}`, { isActive: !c.isActive }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['classroom', 'studio'] }),
  });

  if (studio.isPending) return <div className="p-4"><div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" /></div>;
  if (!studio.data) return <p className="m-4 text-sm text-danger-600">{apiError(studio.error).message}</p>;
  const d = studio.data;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('classroom.nav.studio', 'Classroom Studio')}</h1>
        <Link to="/classroom/new" className="rounded-full bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white">
          {t('classroom.nav.create', '+ New Classroom')}
        </Link>
      </div>
      <StatsTierNote tier={d.tier} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t('classroom.studio.revenueToday', 'Revenue today')} value={formatNgnKobo(d.totals.revenueTodayKobo)} />
        <Stat label={t('classroom.studio.revenueWeek', 'Last 7 days')} value={formatNgnKobo(d.totals.revenueWeekKobo)} />
        <Stat label={t('classroom.studio.revenueMonth', 'Last 30 days')} value={formatNgnKobo(d.totals.revenueMonthKobo)} />
        <Stat label={t('classroom.studio.revenueAll', 'All time')} value={formatNgnKobo(d.totals.revenueAllTimeKobo)} />
        <Stat label={t('classroom.studio.members', 'Members')} value={d.totals.members} />
        <Stat label={t('classroom.studio.pendingReports', 'Pending reports')} value={d.totals.pendingReports} />
      </div>

      <div className="rounded-xl bg-teal-50 dark:bg-teal-900/20 p-3">
        <p className="text-xs text-teal-700">{t('creator.payout.available', 'Available Balance')}</p>
        <p className="text-xl font-bold text-teal-700">{formatNgnKobo(d.availableEarningsKobo)}</p>
        {d.canWithdraw ? (
          <Link to="/creator" className="mt-2 inline-block rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white">
            {t('classroom.studio.withdraw', 'Withdraw earnings')}
          </Link>
        ) : (
          <p className="mt-1 text-xs text-neutral-500">{t('classroom.studio.notCreator', 'Classroom revenue is added to your creator balance. Withdrawals unlock once your account has creator status.')}</p>
        )}
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('classroom.studio.yourClassrooms', 'Your classrooms')}</h2>
      {d.classrooms.length === 0 && <p className="text-sm text-neutral-500">{t('classroom.listing.emptyOwner', "You haven't created a classroom yet.")}</p>}
      {d.classrooms.map((c) => (
        <div key={c.id} className="space-y-2 rounded-xl bg-white dark:bg-neutral-800 p-3">
          <Link to="/classroom/$roomId" params={{ roomId: c.id }} className="flex items-center gap-2">
            <span className="text-2xl">{c.coverEmoji}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{c.name}</span>
              <span className="block text-xs text-neutral-500">
                /c/{c.slug ?? c.id}
                {!c.isActive && ` · ${t('classroom.card.archived', 'Archived')}`}
              </span>
            </span>
          </Link>
          <p className="text-xs text-neutral-500">
            {t('classroom.studio.members', 'Members')}: {c.members} · {t('classroom.studio.paidMembers', 'Paid members')}: {c.paidMembers} · {formatNgnKobo(c.revenueAllTimeKobo)} · {t('classroom.studio.pendingReports', 'Pending reports')}: {c.pendingReports}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/classroom/studio/$roomId" params={{ roomId: c.id }} className="rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-semibold text-white">
              ⚙️ {t('classroom.home.manage', 'Manage')}
            </Link>
            <ClassroomShareButton roomId={c.id} slug={c.slug} name={c.name} />
            <ClassroomBoostButton roomId={c.id} name={c.name} />
            <button type="button" onClick={() => archive.mutate(c)} className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs font-semibold">
              {c.isActive ? t('classroom.studio.archive', 'Archive') : t('classroom.studio.reactivate', 'Reactivate')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export const Route = createFileRoute('/classroom/studio/')({
  component: StudioPage,
});
