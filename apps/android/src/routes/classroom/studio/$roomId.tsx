/**
 * apps/android/src/routes/classroom/studio/$roomId.tsx
 *
 * Per-classroom creator / moderator panel — mirrors apps/web/app/(app)/
 * classroom/studio/[roomId]/page.tsx. Moderators only see the tabs their
 * classroom permissions allow; every action is re-authorized server-side.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiError, get, type ClassroomHome } from '@/lib/classroom/api';
import { ClassroomBoostButton, ClassroomShareButton } from '@/components/classroom/ClassroomActions';
import { EventsPanel } from '@/components/classroom/Panels';
import { CurriculumPanel, MembersPanel, ReportsPanel, SettingsPanel, SlugPanel, StatsPanel } from '@/components/classroom/Studio';

type Tab = 'stats' | 'lessons' | 'members' | 'reports' | 'sessions' | 'url' | 'settings';

function StudioDetailPage() {
  const { roomId } = Route.useParams();
  const { t } = useTranslation();
  const homeQ = useQuery({ queryKey: ['classroom', roomId, 'home'], queryFn: () => get<ClassroomHome>(`/${roomId}`) });
  const [tab, setTab] = useState<Tab | null>(null);

  if (homeQ.isPending) return <div className="p-4"><div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" /></div>;
  const home = homeQ.data;
  if (!home) return <p className="m-4 text-sm text-danger-600">{apiError(homeQ.error).message}</p>;
  const can = home.viewer.can;
  const tabs = ([
    { key: 'stats', label: t('classroom.studio.tabs.stats', 'Stats'), show: can.manageClassroom },
    { key: 'lessons', label: t('classroom.studio.tabs.lessons', 'Lessons'), show: can.manageClassroom },
    { key: 'members', label: t('classroom.studio.tabs.members', 'Members & moderators'), show: can.manageClassroom || can.manageMembers },
    { key: 'reports', label: t('classroom.studio.tabs.reports', 'Reports'), show: can.handleReports },
    { key: 'sessions', label: t('classroom.studio.tabs.sessions', 'Live sessions'), show: can.manageEvents },
    { key: 'url', label: t('classroom.studio.tabs.url', 'URL'), show: can.manageClassroom },
    { key: 'settings', label: t('classroom.studio.tabs.settings', 'Settings'), show: can.manageClassroom },
  ] as Array<{ key: Tab; label: string; show: boolean }>).filter((x) => x.show);
  if (tabs.length === 0) return <p className="m-4 text-sm text-amber-700">{t('classroom.studio.noAccess', "You don't have management access to this classroom.")}</p>;
  const active = tab ?? tabs[0]!.key;
  const c = home.classroom;

  return (
    <div className="space-y-3 p-4">
      <Link to="/classroom/studio" className="text-sm text-neutral-500">
        ← {t('classroom.nav.studio', 'Classroom Studio')}
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{c.coverEmoji}</span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{c.name}</h1>
          <Link to="/classroom/$roomId" params={{ roomId: c.id }} className="text-sm text-primary-600">
            /c/{c.slug ?? c.id}
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ClassroomShareButton roomId={c.id} slug={c.slug} name={c.name} />
        {can.manageClassroom && <ClassroomBoostButton roomId={c.id} name={c.name} />}
      </div>
      <nav className="flex gap-1 overflow-x-auto rounded-xl bg-white dark:bg-neutral-800 p-1">
        {tabs.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${active === tb.key ? 'bg-primary-600 text-white' : 'text-neutral-600 dark:text-neutral-300'}`}>
            {tb.label}
          </button>
        ))}
      </nav>
      {active === 'stats' && <StatsPanel roomId={c.id} />}
      {active === 'lessons' && <CurriculumPanel home={home} />}
      {active === 'members' && <MembersPanel home={home} />}
      {active === 'reports' && <ReportsPanel roomId={c.id} />}
      {active === 'sessions' && <EventsPanel roomId={c.id} canManage isMember />}
      {active === 'url' && <SlugPanel home={home} />}
      {active === 'settings' && home.settings && <SettingsPanel home={home} />}
    </div>
  );
}

export const Route = createFileRoute('/classroom/studio/$roomId')({
  component: StudioDetailPage,
});
