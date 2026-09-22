/**
 * apps/android/src/routes/classroom/index.tsx
 *
 * Classroom hub — mirrors apps/web/app/(app)/classroom/page.tsx:
 * Discover (searchable directory of public classrooms with category chips,
 * free/paid filter and sort; boosted first) and Enrolled (progress + level
 * per classroom), plus shortcuts to My Classrooms, the Classroom Studio and
 * creating a classroom.
 */

import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';
import { apiError, get, type ClassroomCard, type EnrolledClassroom } from '@/lib/classroom/api';
import { ClassroomCardView } from '@/components/classroom/ClassroomCardView';

type Tab = 'discover' | 'enrolled';
type Price = 'all' | 'free' | 'paid';

function ClassroomHubPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('discover');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [price, setPrice] = useState<Price>('all');
  const [sort, setSort] = useState<'popular' | 'new'>('popular');
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const directory = useQuery({
    queryKey: ['classroom', 'directory', q, category, price, sort],
    queryFn: () =>
      get<{ classrooms: ClassroomCard[]; categories: string[] | null }>('/directory', {
        q: q || undefined,
        category: category ?? undefined,
        price,
        sort,
      }),
    enabled: tab === 'discover',
  });
  useEffect(() => {
    if (directory.data?.categories?.length && categories.length === 0) setCategories(directory.data.categories);
  }, [directory.data, categories.length]);

  const enrolled = useQuery({ queryKey: ['classroom', 'enrolled'], queryFn: () => get<{ rooms: EnrolledClassroom[] }>('/enrolled') });

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-semibold ${active ? 'bg-primary-600 text-white' : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'}`;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{t('classroom.title', 'Classroom')}</h1>
        <Link to="/classroom/new" className="rounded-full bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white">
          {t('classroom.nav.create', '+ New Classroom')}
        </Link>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {user?.username && (
          <Link to="/classroom/by/$username" params={{ username: user.username }} className="rounded-full border border-neutral-300 dark:border-neutral-600 px-3 py-1 font-medium">
            {t('classroom.nav.myClassrooms', 'My Classrooms')}
          </Link>
        )}
        <Link to="/classroom/studio" className="rounded-full border border-neutral-300 dark:border-neutral-600 px-3 py-1 font-medium">
          {t('classroom.nav.studio', 'Classroom Studio')}
        </Link>
      </div>

      <div className="flex gap-1 rounded-xl bg-neutral-100 dark:bg-neutral-800 p-1">
        {(['discover', 'enrolled'] as Tab[]).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === k ? 'bg-white dark:bg-neutral-700 shadow-card' : 'text-neutral-500'}`}>
            {k === 'discover'
              ? t('classroom.tabs.discover', 'Discover')
              : `${t('classroom.tabs.enrolled', 'Enrolled')}${enrolled.data?.rooms.length ? ` (${enrolled.data.rooms.length})` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'discover' ? (
        <div className="space-y-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('classroom.directory.searchPlaceholder', 'Search classrooms, topics or creators…')}
            className="w-full rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-4 py-2.5 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'free', 'paid'] as Price[]).map((p) => (
              <button key={p} onClick={() => setPrice(p)} className={chip(price === p)}>
                {t(`classroom.directory.price.${p}`, p)}
              </button>
            ))}
            <select value={sort} onChange={(e) => setSort(e.target.value as 'popular' | 'new')} className="rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1 text-xs">
              <option value="popular">{t('classroom.directory.sort.popular', 'Most popular')}</option>
              <option value="new">{t('classroom.directory.sort.new', 'Newest')}</option>
            </select>
          </div>
          {categories.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button onClick={() => setCategory(null)} className={chip(category === null)}>
                {t('classroom.directory.allCategories', 'All topics')}
              </button>
              {categories.map((c) => (
                <button key={c} onClick={() => setCategory(category === c ? null : c)} className={`${chip(category === c)} shrink-0`}>
                  {c}
                </button>
              ))}
            </div>
          )}
          {directory.isError && <p className="text-sm text-danger-600">{apiError(directory.error).message}</p>}
          {directory.isPending ? (
            <div className="h-28 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ) : directory.data?.classrooms.length === 0 ? (
            <div className="py-12 text-center">
              <span className="text-5xl">🏫</span>
              <p className="mt-3 font-semibold">{t('classroom.empty.browse.title', 'No classrooms open')}</p>
              <p className="text-sm text-neutral-500">
                {q || category || price !== 'all'
                  ? t('classroom.empty.browse.filtered', 'No classrooms match your search. Try different filters.')
                  : t('classroom.empty.browse.subtitle', 'Check back soon for open ClassRooms!')}
              </p>
            </div>
          ) : (
            directory.data?.classrooms.map((c) => <ClassroomCardView key={c.id} classroom={c} />)
          )}
        </div>
      ) : enrolled.isPending ? (
        <div className="h-28 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
      ) : !enrolled.data || enrolled.data.rooms.length === 0 ? (
        <div className="py-12 text-center">
          <span className="text-5xl">📚</span>
          <p className="mt-3 font-semibold">{t('classroom.empty.mine.title', 'No enrolled classrooms')}</p>
          <p className="text-sm text-neutral-500">{t('classroom.empty.mine.subtitle', 'Browse and enroll in a ClassRoom to get started!')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {enrolled.data.rooms.map((r) => {
            const pct = r.lessonCount > 0 ? Math.round((r.completedLessons / r.lessonCount) * 100) : 0;
            return (
              <Link key={r.id} to="/classroom/$roomId" params={{ roomId: r.id }} className="block rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-3xl">{r.coverEmoji}</span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.title}</p>
                      <p className="text-xs text-neutral-500">{t('classroom.card.by', 'By {{name}}', { name: r.creatorName })}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary-100 dark:bg-primary-900/40 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:text-primary-300">
                    {t('classroom.level.short', 'Lvl {{level}}', { level: r.level })} · {t('classroom.points.count', '{{count}} pts', { count: r.points })}
                  </span>
                </div>
                <div className="mt-3 flex justify-between text-xs text-neutral-500">
                  <span>{t('classroom.card.lessonsProgress', '{{completed}} / {{total}} lessons', { completed: r.completedLessons, total: r.lessonCount })}</span>
                  <span>{pct}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                </div>
                {!r.isActive && <p className="mt-1 text-xs text-amber-600">{t('classroom.card.archivedNotice', 'This classroom is archived.')}</p>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/classroom/')({
  component: ClassroomHubPage,
});
