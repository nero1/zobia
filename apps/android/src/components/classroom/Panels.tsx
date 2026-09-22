/**
 * apps/android/src/components/classroom/Panels.tsx
 *
 * Lessons, quizzes, live-session calendar and leaderboard panels for the
 * classroom homepage — mirrors apps/web/components/classroom/{Lessons,
 * Quizzes,Events,Leaderboard}Panel.tsx. External links (lesson videos,
 * resources, meeting rooms, recordings) open in the in-app Browser.
 */

import { useState } from 'react';
import { Browser } from '@capacitor/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiError, get, send, type ClassroomEvent, type ClassroomHome, type LeaderboardEntry, type MemberStanding, type ModuleView } from '@/lib/classroom/api';

const openLink = (url: string) => void Browser.open({ url, presentationStyle: 'popover' });

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export function LessonsPanel({ home, levelName }: { home: ClassroomHome; levelName: (l: number) => string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (m: ModuleView) => send<{ pointsAwarded?: number }>(m.completed ? 'delete' : 'post', `/${roomId}/lessons/${m.id}/complete`),
    onSuccess: (d, m) => {
      if (!m.completed && d.pointsAwarded) setNotice(t('classroom.lessons.completedPoints', 'Lesson complete! +{{points}} points', { points: d.pointsAwarded }));
      void qc.invalidateQueries({ queryKey: ['classroom', roomId, 'home'] });
    },
    onError: (e) => setNotice(apiError(e).message),
  });

  if (home.modules.length === 0) return <p className="py-8 text-center text-sm text-neutral-500">📚 {t('classroom.card.noModules', 'No modules yet.')}</p>;
  const pct = home.progress && home.progress.total > 0 ? Math.round((home.progress.completed / home.progress.total) * 100) : 0;

  return (
    <div className="space-y-2">
      {home.progress && (
        <div className="rounded-xl bg-white dark:bg-neutral-800 p-3">
          <div className="flex justify-between text-xs text-neutral-500">
            <span>{t('classroom.card.lessonsProgress', '{{completed}} / {{total}} lessons', { completed: home.progress.completed, total: home.progress.total })}</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {notice && <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-700">{notice}</p>}
      {home.modules.map((m, i) => (
        <div key={m.id} className="rounded-xl bg-white dark:bg-neutral-800 p-3">
          <button type="button" onClick={() => setOpenId(openId === m.id ? null : m.id)} className="flex w-full items-start gap-3 text-left">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${m.completed ? 'bg-teal-500 text-white' : m.locked ? 'bg-neutral-200 text-neutral-500' : 'bg-primary-100 text-primary-700'}`}>
              {m.completed ? '✓' : m.locked ? '🔒' : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{m.title}</span>
              {m.description && <span className="block text-xs text-neutral-500">{m.description}</span>}
              {m.locked && (
                <span className="block text-[11px] font-semibold text-neutral-500">
                  {!home.viewer.can.viewMemberContent
                    ? t('classroom.lessons.enrolToUnlock', 'Enrol to unlock this lesson')
                    : t('classroom.lessons.unlocksAt', 'Unlocks at level {{level}} ({{name}})', { level: m.unlockLevel ?? 1, name: levelName(m.unlockLevel ?? 1) })}
                </span>
              )}
            </span>
          </button>
          {openId === m.id && !m.locked && (
            <div className="mt-2 space-y-2">
              {m.videoUrl && (
                <button type="button" onClick={() => openLink(m.videoUrl!)} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white">
                  ▶ {t('classroom.lessons.watchVideo', 'Watch lesson video')}
                </button>
              )}
              {m.contentHtml && (
                // Sanitized server-side (web lib/classroom/curriculum.ts → sanitizeBlogPostHtml).
                <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: m.contentHtml }} />
              )}
              {m.resources?.map((r) => (
                <button key={r} type="button" onClick={() => openLink(r)} className="block break-all text-left text-sm text-primary-600">
                  {r}
                </button>
              ))}
              {home.viewer.can.completeLessons && (
                <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate(m)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${m.completed ? 'border border-neutral-300' : 'bg-teal-600 text-white'}`}>
                  {m.completed ? t('classroom.lessons.markIncomplete', 'Mark as not done') : t('classroom.lessons.markComplete', 'Mark complete')}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

interface QuizSummary {
  id: string;
  title: string;
  pass_score: number;
  xp_reward: number;
  questionCount: number;
  attempted: boolean;
  myScore: number | null;
  passed: boolean;
}

interface QuizDetail {
  quiz: { passScore: number };
  questions: Array<{ id: string; question: string; options: Array<{ key: string; text: string }> }>;
  attempt: { score: number; passed: boolean } | null;
}

function QuizTaker({ roomId, quizId, onDone }: { roomId: string; quizId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const detail = useQuery({ queryKey: ['classroom', roomId, 'quiz', quizId], queryFn: () => get<QuizDetail>(`/${roomId}/quizzes/${quizId}`) });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ score: number; passed: boolean; xpAwarded: number; classroomPointsAwarded?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () => send<{ score: number; passed: boolean; xpAwarded: number; classroomPointsAwarded?: number }>('post', `/${roomId}/quizzes/${quizId}/attempt`, { answers }),
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
    onError: (e) => setErr(apiError(e).message),
  });
  if (!detail.data) return <div className="h-16 animate-pulse rounded bg-neutral-100 dark:bg-neutral-700" />;
  const done = result ?? detail.data.attempt;
  if (done) {
    return (
      <p className={`rounded-lg p-2 text-sm ${done.passed ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-800'}`}>
        {done.passed
          ? t('classroom.quiz.passed', 'Passed with {{score}}%!', { score: done.score })
          : t('classroom.quiz.failed', 'You scored {{score}}% (pass mark {{pass}}%).', { score: done.score, pass: detail.data.quiz.passScore })}
        {result?.passed && ` ${t('classroom.quiz.rewards', '+{{xp}} Knowledge XP · +{{points}} classroom points', { xp: result.xpAwarded, points: result.classroomPointsAwarded ?? 0 })}`}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {detail.data.questions.map((q, i) => (
        <fieldset key={q.id} className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-2">
          <legend className="px-1 text-sm font-semibold">
            {i + 1}. {q.question}
          </legend>
          {q.options.map((o) => (
            <label key={o.key} className="flex items-center gap-2 text-sm">
              <input type="radio" name={q.id} checked={answers[q.id] === o.key} onChange={() => setAnswers({ ...answers, [q.id]: o.key })} />
              {o.text}
            </label>
          ))}
        </fieldset>
      ))}
      {err && <p className="text-sm text-danger-600">{err}</p>}
      <p className="text-[11px] text-neutral-500">{t('classroom.quiz.oneAttempt', 'You get one attempt — check your answers before submitting.')}</p>
      <button type="button" disabled={submit.isPending || Object.keys(answers).length < detail.data.questions.length} onClick={() => submit.mutate()} className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {t('classroom.quiz.submit', 'Submit answers')}
      </button>
    </div>
  );
}

export function QuizzesPanel({ roomId, canTake }: { roomId: string; canTake: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const quizzes = useQuery({ queryKey: ['classroom', roomId, 'quizzes'], queryFn: () => get<{ quizzes: QuizSummary[] }>(`/${roomId}/quizzes`) });
  const list = quizzes.data?.quizzes ?? [];
  if (list.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('classroom.quiz.title', 'Quizzes')}</h3>
      {list.map((q) => (
        <div key={q.id} className="rounded-xl bg-white dark:bg-neutral-800 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{q.title}</p>
              <p className="text-[11px] text-neutral-500">
                {t('classroom.quiz.meta', '{{count}} questions · pass {{pass}}% · +{{xp}} XP', { count: q.questionCount, pass: q.pass_score, xp: q.xp_reward })}
                {q.attempted && ` · ${q.passed ? t('classroom.quiz.statusPassed', 'Passed') : t('classroom.quiz.statusAttempted', 'Attempted')} (${q.myScore}%)`}
              </p>
            </div>
            {canTake && (
              <button type="button" onClick={() => setOpenId(openId === q.id ? null : q.id)} className="rounded-lg bg-primary-600 px-3 py-1 text-xs font-semibold text-white">
                {q.attempted ? t('classroom.quiz.viewResult', 'View result') : t('classroom.quiz.start', 'Start quiz')}
              </button>
            )}
          </div>
          {openId === q.id && (
            <div className="mt-2">
              <QuizTaker roomId={roomId} quizId={q.id} onDone={() => void qc.invalidateQueries({ queryKey: ['classroom', roomId] })} />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live sessions
// ---------------------------------------------------------------------------

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function EventsPanel({ roomId, canManage, isMember }: { roomId: string; canManage: boolean; isMember: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ClassroomEvent | 'new' | null>(null);
  const [form, setForm] = useState({ title: '', startsAt: '', endsAt: '', meetingUrl: '', recordingUrl: '' });
  const [err, setErr] = useState<string | null>(null);
  const events = useQuery({ queryKey: ['classroom', roomId, 'events'], queryFn: () => get<{ events: ClassroomEvent[] }>(`/${roomId}/events`, { scope: 'all' }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['classroom', roomId] });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title.trim(),
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        meetingUrl: form.meetingUrl.trim() || null,
        recordingUrl: form.recordingUrl.trim() || null,
      };
      return editing === 'new' ? send('post', `/${roomId}/events`, body) : send('patch', `/${roomId}/events/${(editing as ClassroomEvent).id}`, body);
    },
    onSuccess: () => {
      setEditing(null);
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(apiError(e).message),
  });
  const del = useMutation({ mutationFn: (id: string) => send('delete', `/${roomId}/events/${id}`), onSettled: refresh });

  const start = (e: ClassroomEvent | 'new') => {
    setEditing(e);
    setForm(
      e === 'new'
        ? { title: '', startsAt: '', endsAt: '', meetingUrl: '', recordingUrl: '' }
        : { title: e.title, startsAt: toLocalInput(e.startsAt), endsAt: toLocalInput(e.endsAt), meetingUrl: e.meetingUrl ?? '', recordingUrl: e.recordingUrl ?? '' }
    );
  };
  const field = 'w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm';
  const list = events.data?.events ?? [];

  return (
    <div className="space-y-2">
      {canManage && !editing && (
        <button type="button" onClick={() => start('new')} className="rounded-lg border border-primary-300 px-3 py-1.5 text-sm font-semibold text-primary-600">
          {t('classroom.events.schedule', '+ Schedule a live session')}
        </button>
      )}
      {editing && (
        <div className="space-y-2 rounded-xl bg-white dark:bg-neutral-800 p-3">
          <input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('classroom.events.titlePlaceholder', 'Session title')} />
          <label className="block text-xs text-neutral-500">
            {t('classroom.events.startsAt', 'Starts')}
            <input type="datetime-local" className={field} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </label>
          <label className="block text-xs text-neutral-500">
            {t('classroom.events.endsAt', 'Ends (optional)')}
            <input type="datetime-local" className={field} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </label>
          <input className={field} value={form.meetingUrl} onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })} placeholder={t('classroom.events.meetingUrlPlaceholder', 'Meeting link — Zoom, Google Meet, Teams… (https://)')} />
          <input className={field} value={form.recordingUrl} onChange={(e) => setForm({ ...form, recordingUrl: e.target.value })} placeholder={t('classroom.events.recordingUrlPlaceholder', 'Recording link, after the session (https://)')} />
          {err && <p className="text-xs text-danger-600">{err}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={!form.title.trim() || !form.startsAt || save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {t('classroom.common.save', 'Save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm">
              {t('classroom.common.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}
      {list.length === 0 && !events.isPending && <p className="py-8 text-center text-sm text-neutral-500">📅 {t('classroom.events.empty', 'No live sessions scheduled yet.')}</p>}
      {list.map((e) => (
        <div key={e.id} className="rounded-xl bg-white dark:bg-neutral-800 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{e.title}</p>
              <p className="text-xs text-neutral-500">{new Date(e.startsAt).toLocaleString()}</p>
            </div>
            {e.status === 'live' && <span className="rounded-full bg-danger-100 px-2 text-[11px] font-bold text-danger-700">● {t('classroom.events.live', 'Live now')}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {e.status !== 'ended' && e.meetingUrl && (
              <button type="button" onClick={() => openLink(e.meetingUrl!)} className="rounded-lg bg-primary-600 px-3 py-1.5 font-semibold text-white">
                {t('classroom.events.join', 'Join session ↗')}
              </button>
            )}
            {e.status !== 'ended' && !e.meetingUrl && e.hasMeetingUrl && !isMember && <span className="text-neutral-500">{t('classroom.events.membersOnlyLink', 'Enrol to get the meeting link')}</span>}
            {e.recordingUrl ? (
              <button type="button" onClick={() => openLink(e.recordingUrl!)} className="rounded-lg border border-primary-600 px-3 py-1.5 font-semibold text-primary-700">
                🎬 {t('classroom.events.recording', 'Watch / download recording')}
              </button>
            ) : e.hasRecording && !isMember ? (
              <span className="text-neutral-500">{t('classroom.events.membersOnlyRecording', 'Recording available to members')}</span>
            ) : e.status === 'ended' ? (
              <span className="text-neutral-400">{t('classroom.events.noRecording', 'No recording yet')}</span>
            ) : null}
            {canManage && (
              <>
                <button type="button" onClick={() => start(e)} className="text-neutral-500">
                  {e.status === 'ended' && !e.hasRecording ? t('classroom.events.addRecording', 'Add recording') : t('classroom.feed.edit', 'Edit')}
                </button>
                <button type="button" onClick={() => confirm(t('classroom.events.deleteConfirm', 'Cancel this session?')) && del.mutate(e.id)} className="text-neutral-500">
                  {t('classroom.feed.delete', 'Delete')}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export function LeaderboardPanel({ roomId, viewerId }: { roomId: string; viewerId: string | null }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('30d');
  const board = useQuery({
    queryKey: ['classroom', roomId, 'leaderboard', period],
    queryFn: () =>
      get<{ entries: LeaderboardEntry[]; me: MemberStanding; levels: Array<{ level: number; name: string; minPoints: number }>; badgeCatalog: Array<{ key: string; emoji: string; name: string; description: string }> }>(
        `/${roomId}/leaderboard`,
        { period }
      ),
  });
  const d = board.data;
  const levelName = (l: number) => d?.levels.find((x) => x.level === l)?.name ?? String(l);
  const earned = new Set(d?.me.badges.map((b) => b.key) ?? []);
  return (
    <div className="space-y-3">
      {d && (
        <div className="rounded-xl bg-white dark:bg-neutral-800 p-3">
          <div className="flex justify-between">
            <p className="font-bold">{t('classroom.level.full', 'Level {{level}} · {{name}}', { level: d.me.level, name: levelName(d.me.level) })}</p>
            <p className="font-bold text-primary-600">{t('classroom.points.count', '{{count}} pts', { count: d.me.points })}</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div className="h-full rounded-full bg-primary-500" style={{ width: `${d.me.percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {d.me.pointsToNextLevel === null
              ? t('classroom.leaderboard.maxLevel', 'Top level reached — legend!')
              : t('classroom.leaderboard.toNext', '{{points}} points to level {{level}}', { points: d.me.pointsToNextLevel, level: d.me.level + 1 })}
          </p>
        </div>
      )}
      <div className="flex gap-1 rounded-xl bg-neutral-100 dark:bg-neutral-800 p-1">
        {(['7d', '30d', 'all'] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${period === p ? 'bg-white dark:bg-neutral-700' : 'text-neutral-500'}`}>
            {t(`classroom.leaderboard.period.${p}`, p)}
          </button>
        ))}
      </div>
      {!d || d.entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-500">{t('classroom.leaderboard.empty', 'No points earned in this period yet.')}</p>
      ) : (
        <ol className="divide-y divide-neutral-100 dark:divide-neutral-700 rounded-xl bg-white dark:bg-neutral-800">
          {d.entries.map((e) => (
            <li key={e.userId} className={`flex items-center gap-3 px-3 py-2 ${e.userId === viewerId ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
              <span className="w-7 text-center text-sm font-bold text-neutral-400">{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : `#${e.rank}`}</span>
              <span className="text-xl">{e.avatarEmoji}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.displayName}</span>
              <span className="text-sm font-bold text-primary-600">{period === 'all' ? e.points : `+${e.points}`}</span>
            </li>
          ))}
        </ol>
      )}
      {d && (
        <div className="grid grid-cols-2 gap-2">
          {d.badgeCatalog.map((b) => (
            <div key={b.key} className={`flex items-center gap-2 rounded-lg bg-white dark:bg-neutral-800 p-2 text-xs ${earned.has(b.key) ? '' : 'opacity-40'}`}>
              <span className="text-lg">{b.emoji}</span>
              {t(`classroom.badges.${b.key}.name`, b.name)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
