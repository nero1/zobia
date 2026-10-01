/**
 * apps/android/src/routes/classroom/$roomId.tsx
 *
 * Classroom homepage — the Android counterpart of web's /c/<slug>
 * (apps/web/components/classroom/ClassroomHome.tsx). Tabs: Community ·
 * Classroom (lessons + quizzes) · Events · Leaderboard · About. Header:
 * Enrol (Credits, or card via the Paystack checkout in the in-app browser),
 * Share, Boost (creator) and Manage (creator/moderators → Studio).
 *
 * Deep links: https://<web>/c/<slug> and zobia://c/<slug> land on
 * routes/c/$slug.tsx, which resolves the slug and redirects here.
 */

import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { apiError, get, send, type ClassroomHome } from '@/lib/classroom/api';
import { ClassroomBoostButton, ClassroomShareButton } from '@/components/classroom/ClassroomActions';
import { CommunityFeed } from '@/components/classroom/Community';
import { EventsPanel, LeaderboardPanel, LessonsPanel, QuizzesPanel } from '@/components/classroom/Panels';
import { useFiatCurrency, formatKoboClient } from '@/lib/hooks/useFiatCurrency';
import { Icon } from '@/components/ui/Icon';

type Tab = 'community' | 'classroom' | 'events' | 'leaderboard' | 'about';

/** `?tab=` deep-link value to a Tab ('calendar' is the pre-rename alias). */
function tabFromParam(v: string | undefined): Tab | null {
  if (v === 'calendar') return 'events';
  return v === 'community' || v === 'classroom' || v === 'events' || v === 'leaderboard' || v === 'about' ? v : null;
}

function EnrolAction({ home, onEnrolled }: { home: ClassroomHome; onEnrolled: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fee = home.classroom.enrolmentFeeNgn;
  const { data: fiat = { currency: 'USD' as const, isNigeria: false, usdToNgnRate: '1600' } } = useFiatCurrency();
  const enrol = useMutation({
    mutationFn: (paymentMethod: 'balance' | 'card') => send<{ requiresCardPayment?: boolean; paymentUrl?: string }>('post', `/${home.classroom.id}/enroll`, { paymentMethod }),
    onSuccess: async (d) => {
      if (d.requiresCardPayment && d.paymentUrl) {
        setOpen(false);
        await Browser.open({ url: d.paymentUrl, presentationStyle: 'popover' });
        return;
      }
      setOpen(false);
      onEnrolled();
    },
    onError: (e) => {
      const { code, message } = apiError(e);
      setErr(code === 'INSUFFICIENT_BALANCE' ? t('classroom.enroll.insufficient', "You don't have enough Credits. Top up or pay by card.") : message);
    },
  });
  if (fee <= 0) {
    return (
      <span className="flex flex-col items-end">
        <button type="button" disabled={enrol.isPending} onClick={() => enrol.mutate('balance')} className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {enrol.isPending ? t('classroom.card.enrolling', 'Enrolling…') : t('classroom.enroll.joinFree', 'Join for free')}
        </button>
        {err && <span className="text-xs text-danger-600">{err}</span>}
      </span>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white">
        {t('classroom.enroll.joinPaid', 'Enrol · {{amount}} Credits', { amount: fee.toLocaleString() })}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm space-y-2 rounded-2xl bg-white dark:bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold">{t('classroom.enroll.modalTitle', 'Enrol in this classroom')}</h2>
            <p className="text-sm text-neutral-500">
              {t('classroom.enroll.modalBody', 'One-time enrolment fee: {{amount}} Credits (≈{{fiatAmount}}). You keep access to the community, lessons and recordings.', { amount: fee.toLocaleString(), fiatAmount: formatKoboClient(fee * 100, fiat) })}
            </p>
            {err && <p className="text-xs text-danger-600">{err}</p>}
            <button type="button" disabled={enrol.isPending} onClick={() => enrol.mutate('balance')} className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {t('classroom.enroll.payCredits', 'Pay with Credits')}
            </button>
            <button type="button" disabled={enrol.isPending} onClick={() => enrol.mutate('card')} className="w-full rounded-xl border border-primary-600 py-2.5 text-sm font-semibold text-primary-700 disabled:opacity-60">
              {t('classroom.enroll.payCard', 'Pay by card')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="w-full py-2 text-sm text-neutral-500">
              {t('classroom.common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ClassroomHomePage() {
  const { roomId } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const homeQ = useQuery({ queryKey: ['classroom', roomId, 'home'], queryFn: () => get<ClassroomHome>(`/${roomId}`) });
  const { tab: tabParam, event: focusEventId } = Route.useSearch();
  const [tab, setTab] = useState<Tab | null>(tabFromParam(tabParam));
  // A notification tap while this screen is already open only changes the URL.
  useEffect(() => {
    const next = tabFromParam(tabParam);
    if (next) setTab(next);
  }, [tabParam, focusEventId]);

  // Coming back from the Paystack checkout (in-app browser) — refresh so the
  // webhook-created enrolment shows up.
  useEffect(() => {
    const sub = CapApp.addListener('resume', () => void qc.invalidateQueries({ queryKey: ['classroom', roomId] }));
    const closed = Browser.addListener('browserFinished', () => void qc.invalidateQueries({ queryKey: ['classroom', roomId] }));
    return () => {
      void sub.then((h) => h.remove());
      void closed.then((h) => h.remove());
    };
  }, [qc, roomId]);

  const home = homeQ.data;
  const levelName = useMemo(() => {
    const m = new Map((home?.classroom.levels ?? []).map((l) => [l.level, l.name]));
    return (level: number) => m.get(level) ?? String(level);
  }, [home?.classroom.levels]);

  if (homeQ.isPending) return <div className="p-4"><div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" /></div>;
  if (!home) return <p className="m-4 rounded-xl bg-danger-50 p-3 text-sm text-danger-700">{apiError(homeQ.error).message}</p>;

  const { classroom, viewer } = home;
  const insider = viewer.can.viewMemberContent;
  const active: Tab = tab ?? (insider ? 'community' : 'about');
  const tabs: Array<{ key: Tab; label: string; locked: boolean }> = [
    { key: 'community', label: t('classroom.home.tabs.community', 'Community'), locked: !insider },
    { key: 'classroom', label: t('classroom.home.tabs.classroom', 'Classroom'), locked: false },
    { key: 'events', label: t('classroom.home.tabs.events', 'Events'), locked: false },
    { key: 'leaderboard', label: t('classroom.home.tabs.leaderboard', 'Leaderboard'), locked: !insider },
    { key: 'about', label: t('classroom.home.tabs.about', 'About'), locked: false },
  ];
  const lockedPrompt = (
    <p className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
      <Icon emoji="🔒" size={14} /> {t('classroom.home.membersOnly', 'Enrol in this classroom to join the community, climb the leaderboard and access every lesson.')}
    </p>
  );

  return (
    <div className="space-y-3 p-4">
      <Link to="/classroom" className="inline-flex items-center gap-1 text-sm text-neutral-500">
        <Icon emoji="←" size={14} /> {t('classroom.home.back', 'All classrooms')}
      </Link>
      <header className="space-y-3 rounded-2xl bg-white dark:bg-neutral-800 p-4 shadow-card">
        <div className="flex items-start gap-3">
          <span className="text-4xl">{classroom.coverEmoji}</span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{classroom.name}</h1>
            <p className="text-xs text-neutral-500">
              @{classroom.creator.username} · {t('classroom.card.members', '{{count}} members', { count: classroom.memberCount })} ·{' '}
              {classroom.enrolmentFeeNgn > 0 ? t('classroom.card.fee', '{{amount}} Credits', { amount: classroom.enrolmentFeeNgn.toLocaleString() }) : t('classroom.card.free', 'Free')}
            </p>
            {!classroom.isActive && <p className="text-xs font-semibold text-danger-600">{t('classroom.card.archived', 'Archived')}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!viewer.isEnrolled && !viewer.isCreator && classroom.isActive ? (
            <EnrolAction home={home} onEnrolled={() => void qc.invalidateQueries({ queryKey: ['classroom'] })} />
          ) : viewer.isEnrolled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700"><Icon emoji="✓" size={12} /> {t('classroom.card.enrolled', 'Enrolled')}</span>
          ) : null}
          <ClassroomShareButton roomId={classroom.id} slug={classroom.slug} name={classroom.name} />
          {/* The classroom's official chat Room (its id is the classroom id). */}
          {insider && classroom.chatRoomEnabled && (
            <Link to="/rooms/$roomId" params={{ roomId: classroom.id }} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200">
              <Icon emoji="💬" size={14} /> {t('classroom.home.chat', 'Chat')}
            </Link>
          )}
          {viewer.can.manageClassroom && <ClassroomBoostButton roomId={classroom.id} name={classroom.name} />}
          {(viewer.can.manageClassroom || viewer.isModerator) && (
            <Link to="/classroom/studio/$roomId" params={{ roomId: classroom.id }} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs font-semibold">
              <Icon emoji="⚙️" size={12} /> {t('classroom.home.manage', 'Manage')}
            </Link>
          )}
        </div>
        {insider && home.standing && (
          <div className="rounded-xl bg-primary-50 dark:bg-primary-900/20 p-2">
            <div className="flex justify-between text-sm">
              <span className="font-semibold">{t('classroom.level.full', 'Level {{level}} · {{name}}', { level: home.standing.level, name: levelName(home.standing.level) })}</span>
              <span>{t('classroom.points.count', '{{count}} pts', { count: home.standing.points })}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-primary-200">
              <div className="h-full rounded-full bg-primary-600" style={{ width: `${home.standing.percent}%` }} />
            </div>
          </div>
        )}
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-xl bg-white dark:bg-neutral-800 p-1">
        {tabs.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${active === tb.key ? 'bg-primary-600 text-white' : 'text-neutral-600 dark:text-neutral-300'}`}>
            {tb.label}
            {tb.locked && <Icon emoji="🔒" size={11} className="ml-1 inline" />}
          </button>
        ))}
      </nav>

      {active === 'community' && (insider ? <CommunityFeed home={home} /> : lockedPrompt)}
      {active === 'classroom' && (
        <div className="space-y-4">
          <LessonsPanel home={home} levelName={levelName} />
          {insider && <QuizzesPanel roomId={classroom.id} canTake={viewer.isEnrolled} />}
        </div>
      )}
      {active === 'events' &&
        // The full events list needs member access (or manage rights) on a
        // private classroom; others get the public upcoming list from the
        // home payload instead of a request that would 403.
        (classroom.isPublic || insider || viewer.can.manageEvents ? (
          <EventsPanel roomId={classroom.id} canManage={viewer.can.manageEvents} isMember={insider} focusEventId={focusEventId ?? null} />
        ) : home.upcomingEvents.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">{t('classroom.events.empty', 'No live sessions scheduled yet.')}</p>
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
      {active === 'leaderboard' && (insider ? <LeaderboardPanel roomId={classroom.id} viewerId={viewer.userId} /> : lockedPrompt)}
      {active === 'about' && (
        <section className="space-y-3 rounded-xl bg-white dark:bg-neutral-800 p-4 text-sm">
          <p className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{classroom.description || t('classroom.home.noDescription', "The creator hasn't added a description yet.")}</p>
          <p className="text-neutral-500">
            {t('classroom.home.lessons', 'Lessons')}: {home.modules.length}
            {(classroom.classStartDate || classroom.classEndDate) && ` · ${t('classroom.home.dates', 'Dates')}: ${classroom.classStartDate ?? '…'} – ${classroom.classEndDate ?? '…'}`}
          </p>
          {home.moderators.length > 0 && (
            <p className="text-neutral-500">
              {t('classroom.home.moderators', 'Moderators')}: {home.moderators.map((m) => `${m.avatarEmoji} @${m.username}`).join(' · ')}
            </p>
          )}
          <Link to="/classroom/by/$username" params={{ username: classroom.creator.username }} className="font-medium text-primary-600">
            {t('classroom.home.moreByCreator', 'More classrooms by @{{username}} →', { username: classroom.creator.username })}
          </Link>
        </section>
      )}
    </div>
  );
}

export const Route = createFileRoute('/classroom/$roomId')({
  validateSearch: (search: Record<string, unknown>): { tab?: string; event?: string } => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
    event: typeof search.event === 'string' ? search.event : undefined,
  }),
  component: ClassroomHomePage,
});
