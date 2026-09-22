/**
 * apps/android/src/components/classroom/Studio.tsx
 *
 * Per-classroom creator/moderator panels — mirrors apps/web/components/
 * classroom/studio/*: stats (plan/creator-tier gated), lessons CRUD +
 * reorder, members & moderators (grant/revoke, mute), report queue, URL
 * (slug change with server quote + change policy) and settings.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  apiError,
  formatNgnKobo,
  get,
  send,
  type ClassroomHome,
  type ClassroomReport,
  type ClassroomSettings,
  type ClassroomStats,
  type Member,
  type ModeratorPermissions,
  type ModuleView,
  type SlugAvailability,
  type SlugPolicy,
  type SlugQuote,
} from '@/lib/classroom/api';

const field = 'w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm';
const card = 'space-y-2 rounded-xl bg-white dark:bg-neutral-800 p-3';

export function StatsTierNote({ tier }: { tier: string }) {
  const { t } = useTranslation();
  if (tier === 'detailed') return null;
  return (
    <p className="rounded-lg bg-primary-50 dark:bg-primary-900/20 px-3 py-2 text-xs text-primary-800 dark:text-primary-200">
      {tier === 'basic'
        ? t('classroom.studio.tierBasic', "You're seeing basic stats. Upgrade to Plus (or reach Rising creator tier) for activity trends, or to Pro/Max (or Verified creator) for daily charts, lesson funnels and conversion.")
        : t('classroom.studio.tierMore', 'Upgrade to Pro/Max (or reach Verified creator tier) for daily charts, lesson funnels and conversion analytics.')}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-neutral-50 dark:bg-neutral-900 p-2">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="font-bold tabular-nums">{value}</p>
    </div>
  );
}

export function StatsPanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const stats = useQuery({ queryKey: ['classroom', roomId, 'stats'], queryFn: () => get<ClassroomStats>(`/${roomId}/stats`) });
  const s = stats.data;
  if (!s) return <div className="h-32 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  const max = Math.max(1, ...(s.detailed?.daily.map((d) => d.enrolments) ?? [1]));
  return (
    <div className="space-y-3">
      <StatsTierNote tier={s.tier} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t('classroom.studio.members', 'Members')} value={s.basic.members} />
        <Stat label={t('classroom.studio.paidMembers', 'Paid members')} value={s.basic.paidMembers} />
        <Stat label={t('classroom.studio.revenueAll', 'All time')} value={formatNgnKobo(s.basic.revenueAllTimeKobo)} />
        <Stat label={t('classroom.stats.posts', 'Posts')} value={s.basic.posts} />
        <Stat label={t('classroom.home.lessons', 'Lessons')} value={s.basic.lessons} />
        <Stat label={t('classroom.stats.upcomingSessions', 'Upcoming sessions')} value={s.basic.upcomingEvents} />
      </div>
      {s.more && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t('classroom.stats.new30d', 'New members (30d)')} value={s.more.newMembers30d} />
          <Stat label={t('classroom.studio.active7d', 'Active (7d)')} value={s.more.activeMembers7d} />
          <Stat label={t('classroom.studio.revenueMonth', 'Last 30 days')} value={formatNgnKobo(s.more.revenue30dKobo)} />
          <Stat label={t('classroom.stats.completionRate', 'Lesson completion')} value={`${s.more.lessonCompletionRate}%`} />
          <Stat label={t('classroom.stats.quizPassRate', 'Quiz pass rate')} value={`${s.more.quizPassRate}%`} />
          <Stat label={t('classroom.stats.views30d', 'Page views (30d)')} value={s.more.pageViews30d} />
        </div>
      )}
      {s.detailed && (
        <div className={card}>
          <p className="text-xs font-semibold uppercase text-neutral-500">{t('classroom.stats.dailyEnrolments', 'Enrolments — last 30 days')}</p>
          <div className="flex h-20 items-end gap-[2px] border-b border-neutral-200">
            {s.detailed.daily.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.enrolments}`} className="flex-1 rounded-t bg-primary-500" style={{ height: d.enrolments > 0 ? `${Math.max(4, (d.enrolments / max) * 100)}%` : '0%' }} />
            ))}
          </div>
          <p className="text-xs text-neutral-500">
            {s.detailed.viewToEnrolmentRate === null
              ? t('classroom.stats.noConversion', 'No page views in the last 30 days yet.')
              : t('classroom.stats.conversion', 'View → enrolment conversion (30d): {{rate}}%', { rate: s.detailed.viewToEnrolmentRate })}
          </p>
          <p className="text-xs font-semibold uppercase text-neutral-500">{t('classroom.stats.lessonFunnel', 'Lesson funnel')}</p>
          {s.detailed.lessonFunnel.map((l, i) => (
            <p key={l.moduleId} className="flex justify-between text-sm">
              <span>
                {i + 1}. {l.title}
              </span>
              <span className="tabular-nums">{l.completions}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function CurriculumPanel({ home }: { home: ClassroomHome }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [editing, setEditing] = useState<ModuleView | 'new' | null>(null);
  const [form, setForm] = useState({ title: '', description: '', content: '', videoUrl: '', unlockLevel: 1 });
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['classroom', roomId, 'home'] });
  const onErr = (e: unknown) => setErr(apiError(e).message);
  const save = useMutation({
    mutationFn: () => {
      const body = { title: form.title.trim(), description: form.description.trim() || undefined, content: form.content.trim() || undefined, videoUrl: form.videoUrl.trim(), unlockLevel: form.unlockLevel };
      return editing === 'new' ? send('post', `/${roomId}/modules`, body) : send('patch', `/${roomId}/modules`, { id: (editing as ModuleView).id, ...body });
    },
    onSuccess: () => {
      setEditing(null);
      setErr(null);
      refresh();
    },
    onError: onErr,
  });
  const del = useMutation({ mutationFn: (id: string) => send('delete', `/${roomId}/modules`, { id }), onSuccess: refresh, onError: onErr });
  const reorder = useMutation({ mutationFn: (order: string[]) => send('put', `/${roomId}/modules`, { order }), onSuccess: refresh, onError: onErr });
  const move = (i: number, dir: -1 | 1) => {
    const ids = home.modules.map((m) => m.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  const start = (m: ModuleView | 'new') => {
    setEditing(m);
    setForm(m === 'new' ? { title: '', description: '', content: '', videoUrl: '', unlockLevel: 1 } : { title: m.title, description: m.description ?? '', content: m.content ?? '', videoUrl: m.videoUrl ?? '', unlockLevel: m.unlockLevel ?? 1 });
  };

  return (
    <div className="space-y-2">
      {err && <p className="text-sm text-danger-600">{err}</p>}
      {home.modules.map((m, i) => (
        <div key={m.id} className="flex items-center gap-2 rounded-xl bg-white dark:bg-neutral-800 p-3">
          <span className="w-5 text-sm font-bold text-neutral-400">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.title}</span>
          <button type="button" onClick={() => move(i, -1)} className="px-1 text-neutral-400">↑</button>
          <button type="button" onClick={() => move(i, 1)} className="px-1 text-neutral-400">↓</button>
          <button type="button" onClick={() => start(m)} className="text-xs text-primary-600">{t('classroom.feed.edit', 'Edit')}</button>
          <button type="button" onClick={() => confirm(t('classroom.module.deleteConfirm', 'Delete this module?')) && del.mutate(m.id)} className="text-xs text-danger-500">
            {t('classroom.module.delete', 'Delete')}
          </button>
        </div>
      ))}
      {editing ? (
        <div className={card}>
          <input className={field} value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('classroom.module.titlePlaceholder', 'e.g. Introduction to JavaScript')} />
          <textarea className={field} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('classroom.module.descriptionPlaceholder', 'Briefly describe this module…')} />
          <textarea className={`${field} font-mono`} rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={t('classroom.module.contentPlaceholder', 'Lesson content (Markdown supported)')} />
          <input className={field} value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder={t('classroom.module.videoPlaceholder', 'Video link (YouTube, Vimeo, Loom…) — optional')} />
          <label className="block text-xs text-neutral-500">
            {t('classroom.module.unlockLevel', 'Unlocks at level')}
            <select className={field} value={form.unlockLevel} onChange={(e) => setForm({ ...form, unlockLevel: parseInt(e.target.value, 10) })}>
              {Array.from({ length: 9 }).map((_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={!form.title.trim() || save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {t('classroom.common.save', 'Save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm">
              {t('classroom.module.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => start('new')} className="rounded-lg border border-primary-300 px-3 py-1.5 text-sm font-semibold text-primary-600">
          {t('classroom.card.addModule', '+ Add Module')}
        </button>
      )}
    </div>
  );
}

export function MembersPanel({ home }: { home: ClassroomHome }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'moderators' | 'paid' | 'muted'>('all');
  const [msg, setMsg] = useState<string | null>(null);
  const members = useQuery({ queryKey: ['classroom', roomId, 'members', search, filter], queryFn: () => get<{ members: Member[]; total: number }>(`/${roomId}/members`, { search: search.trim() || undefined, filter }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['classroom', roomId] });
  const onErr = (e: unknown) => setMsg(apiError(e).message);
  const grant = useMutation({ mutationFn: (m: Member) => send('post', `/${roomId}/moderators`, { userId: m.userId }), onSuccess: refresh, onError: onErr });
  const revoke = useMutation({ mutationFn: (m: Member) => send('delete', `/${roomId}/moderators/${m.userId}`), onSuccess: refresh, onError: onErr });
  const mute = useMutation({ mutationFn: ({ m, hours }: { m: Member; hours: number | null }) => send('patch', `/${roomId}/members/${m.userId}`, { muteHours: hours }), onSuccess: refresh, onError: onErr });
  const canMods = home.viewer.can.manageClassroom;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={field} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('classroom.members.search', 'Search members…')} />
        <select className="rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">{t('classroom.members.filter.all', 'All members')}</option>
          <option value="moderators">{t('classroom.members.filter.moderators', 'Moderators')}</option>
          <option value="paid">{t('classroom.members.filter.paid', 'Paid')}</option>
          <option value="muted">{t('classroom.members.filter.muted', 'Muted')}</option>
        </select>
      </div>
      {canMods && <p className="text-xs text-neutral-500">{t('classroom.members.moderatorHint', 'Any member — paid or free — can be made a moderator. Choose what moderators may do in Settings.')}</p>}
      {msg && <p className="text-sm text-danger-600">{msg}</p>}
      {(members.data?.members ?? []).map((m) => (
        <div key={m.userId} className="rounded-xl bg-white dark:bg-neutral-800 p-3">
          <p className="text-sm font-semibold">
            {m.avatarEmoji} {m.displayName} <span className="font-normal text-neutral-500">@{m.username}</span>
          </p>
          <p className="text-[11px] text-neutral-500">
            {t('classroom.level.short', 'Lvl {{level}}', { level: m.level })} · {t('classroom.points.count', '{{count}} pts', { count: m.points })} · {m.paid ? t('classroom.members.paid', 'Paid') : t('classroom.card.free', 'Free')}
            {m.isModerator && ` · ${t('classroom.roles.moderator', 'Moderator')}`}
            {m.mutedUntil && ` · ${t('classroom.members.mutedUntil', 'Muted until {{date}}', { date: new Date(m.mutedUntil).toLocaleString() })}`}
          </p>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            {canMods && (m.isModerator ? (
              <button type="button" onClick={() => revoke.mutate(m)} className="rounded border border-neutral-300 px-2 py-0.5">{t('classroom.members.revoke', 'Remove moderator')}</button>
            ) : (
              <button type="button" onClick={() => grant.mutate(m)} className="rounded border border-sky-400 px-2 py-0.5 text-sky-700">{t('classroom.members.makeModerator', 'Make moderator')}</button>
            ))}
            {home.viewer.can.manageMembers && m.userId !== home.viewer.userId && (m.mutedUntil ? (
              <button type="button" onClick={() => mute.mutate({ m, hours: null })} className="rounded border border-neutral-300 px-2 py-0.5">{t('classroom.members.unmute', 'Unmute')}</button>
            ) : (
              <button type="button" onClick={() => mute.mutate({ m, hours: 24 })} className="rounded border border-neutral-300 px-2 py-0.5">{t('classroom.members.mute', 'Mute')} · {t('classroom.members.mute24h', '24 hours')}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReportsPanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const reports = useQuery({ queryKey: ['classroom', roomId, 'reports'], queryFn: () => get<{ reports: ClassroomReport[] }>(`/${roomId}/reports`, { status: 'pending' }) });
  const resolve = useMutation({
    mutationFn: ({ r, action }: { r: ClassroomReport; action: 'remove' | 'dismiss' }) => send('patch', `/${roomId}/reports/${r.id}`, { action }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['classroom', roomId, 'reports'] }),
  });
  const list = reports.data?.reports ?? [];
  if (list.length === 0) return <p className="py-8 text-center text-sm text-neutral-500">{t('classroom.reports.empty', 'Nothing to review. 🎉')}</p>;
  return (
    <div className="space-y-2">
      {list.map((r) => (
        <div key={r.id} className={card}>
          <p className="text-xs text-neutral-500">
            <span className="font-semibold text-danger-600">{t(`classroom.report.reasons.${r.reason}`, r.reason)}</span> · {t('classroom.reports.by', 'by @{{username}}', { username: r.target.author.username })} · {t('classroom.reports.reportedBy', 'reported by @{{username}}', { username: r.reporter.username })}
          </p>
          <p className="line-clamp-4 whitespace-pre-wrap rounded bg-neutral-50 dark:bg-neutral-900 p-2 text-sm">{r.target.body}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => resolve.mutate({ r, action: 'remove' })} className="rounded-lg bg-danger-600 px-3 py-1 text-xs font-semibold text-white">{t('classroom.reports.remove', 'Remove content')}</button>
            <button type="button" onClick={() => resolve.mutate({ r, action: 'dismiss' })} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs">{t('classroom.reports.dismiss', 'Dismiss')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SlugPanel({ home }: { home: ClassroomHome }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const key = ['classroom', roomId, 'slug'];
  const data = useQuery({ queryKey: key, queryFn: () => get<{ slug: string | null; quote: SlugQuote }>(`/${roomId}/slug`) });
  const [candidate, setCandidate] = useState('');
  const [avail, setAvail] = useState<SlugAvailability | null>(null);
  const [policy, setPolicy] = useState<SlugPolicy | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (data.data && !policy) setPolicy(data.data.quote.policy);
  }, [data.data, policy]);
  useEffect(() => {
    if (!candidate.trim()) return setAvail(null);
    const id = setTimeout(() => get<SlugAvailability>('/slug', { slug: candidate.trim(), roomId }).then(setAvail).catch(() => setAvail(null)), 400);
    return () => clearTimeout(id);
  }, [candidate, roomId]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['classroom', roomId] });
  const change = useMutation({
    mutationFn: () => send<{ newSlug: string }>('post', `/${roomId}/slug`, { slug: avail?.slug ?? candidate.trim(), expectedCostCredits: data.data?.quote.costCredits ?? 0 }),
    onSuccess: (r) => {
      setMsg(t('classroom.slug.changed', 'URL changed to /c/{{slug}}', { slug: r.newSlug }));
      setCandidate('');
      refresh();
    },
    onError: (e) => {
      const { code, message } = apiError(e);
      setMsg(code === 'INSUFFICIENT_BALANCE' ? t('classroom.slug.insufficient', "You don't have enough Credits for this change.") : message);
      refresh();
    },
  });
  const savePolicy = useMutation({
    mutationFn: (p: SlugPolicy) => send('patch', `/${roomId}`, { settings: { slugPolicy: p } }),
    onSuccess: () => {
      setMsg(t('classroom.slug.policySaved', 'URL change policy saved'));
      refresh();
    },
    onError: (e) => setMsg(apiError(e).message),
  });
  if (!data.data || !policy) return <div className="h-32 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  const q = data.data.quote;
  const confirmText =
    q.costCredits > 0
      ? t('classroom.slug.confirmPaid', 'Change the URL to /c/{{slug}} for {{cost}} Credits? The old URL will redirect here.', { slug: avail?.slug, cost: q.costCredits })
      : t('classroom.slug.confirmFree', 'Change the URL to /c/{{slug}}? The old URL will redirect here.', { slug: avail?.slug });
  return (
    <div className="space-y-3">
      <div className={card}>
        <p className="text-sm">
          {t('classroom.slug.current', 'Current URL:')} <span className="font-mono">/c/{data.data.slug ?? roomId}</span>
        </p>
        <p className="text-xs text-neutral-500">
          {q.policy.mode === 'free'
            ? t('classroom.slug.quoteFree', 'URL changes are free and unlimited.')
            : q.costCredits === 0
              ? t('classroom.slug.quoteFreeLeft', 'Your next change is free ({{count}} free change(s) left).', { count: q.freeChangesRemaining ?? 0 })
              : t('classroom.slug.quoteCost', 'Your next change costs {{cost}} Credits.', { cost: q.costCredits })}
          {!q.eligible && q.nextEligibleAt && ` ${t('classroom.slug.cooldown', 'You can change it again after {{date}}.', { date: new Date(q.nextEligibleAt).toLocaleString() })}`}
        </p>
        <input className={field} value={candidate} maxLength={60} onChange={(e) => setCandidate(e.target.value.toLowerCase())} placeholder={data.data.slug ?? ''} />
        {avail && <p className={`text-xs ${avail.available ? 'text-teal-600' : 'text-danger-600'}`}>{avail.available ? t('classroom.slug.available', 'Available: /c/{{slug}}', { slug: avail.slug }) : t('classroom.slug.taken', 'That URL is already taken.')}</p>}
        <button type="button" disabled={!avail?.available || !q.eligible || change.isPending} onClick={() => confirm(confirmText) && change.mutate()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {t('classroom.slug.change', 'Change URL')}
        </button>
      </div>
      <div className={card}>
        <p className="text-sm font-semibold">{t('classroom.slug.policyTitle', 'URL change policy')}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={policy.mode === 'paid'} onChange={() => setPolicy({ ...policy, mode: 'paid' })} />
          {t('classroom.slug.modePaid', 'Free changes, then a Credit cost per change')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={policy.mode === 'free'} onChange={() => setPolicy({ ...policy, mode: 'free' })} />
          {t('classroom.slug.modeFree', 'Always free and uncapped')}
        </label>
        {policy.mode === 'paid' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-500">
              {t('classroom.slug.freeChanges', 'Free changes')}
              <input type="number" min={0} className={field} value={policy.freeChanges} onChange={(e) => setPolicy({ ...policy, freeChanges: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
            </label>
            <label className="text-xs text-neutral-500">
              {t('classroom.slug.costPerChange', 'Credits per change after that')}
              <input type="number" min={0} className={field} value={policy.costCredits} onChange={(e) => setPolicy({ ...policy, costCredits: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
            </label>
            <label className="text-xs text-neutral-500">
              {t('classroom.slug.cooldownUnit', 'Limit how often')}
              <select className={field} value={policy.cooldownUnit} onChange={(e) => setPolicy({ ...policy, cooldownUnit: e.target.value as SlugPolicy['cooldownUnit'] })}>
                <option value="none">{t('classroom.slug.cooldown.none', 'No cap')}</option>
                <option value="days">{t('classroom.slug.cooldown.days', 'Once every N days')}</option>
                <option value="months">{t('classroom.slug.cooldown.months', 'Once every N months')}</option>
              </select>
            </label>
            {policy.cooldownUnit !== 'none' && (
              <label className="text-xs text-neutral-500">
                {t('classroom.slug.cooldownValue', 'N')}
                <input type="number" min={1} max={365} className={field} value={policy.cooldownValue} onChange={(e) => setPolicy({ ...policy, cooldownValue: Math.min(365, Math.max(1, parseInt(e.target.value || '1', 10) || 1)) })} />
              </label>
            )}
          </div>
        )}
        <button type="button" onClick={() => savePolicy.mutate(policy)} className="rounded-lg border border-primary-600 px-4 py-1.5 text-sm font-semibold text-primary-700">
          {t('classroom.slug.savePolicy', 'Save policy')}
        </button>
      </div>
      {msg && <p className="text-sm text-neutral-700 dark:text-neutral-300">{msg}</p>}
    </div>
  );
}

export function SettingsPanel({ home }: { home: ClassroomHome }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const c = home.classroom;
  const settings = home.settings as ClassroomSettings;
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? '');
  const [fee, setFee] = useState(String(c.enrolmentFeeNgn));
  const [isPublic, setIsPublic] = useState(c.isPublic);
  const [isActive, setIsActive] = useState(c.isActive);
  const [listed, setListed] = useState(c.showInCreatorListing);
  const [posting, setPosting] = useState(settings.postingPolicy);
  const [cats, setCats] = useState(settings.postCategories.join(', '));
  const [levels, setLevels] = useState(settings.levelNames);
  const [perms, setPerms] = useState<ModeratorPermissions>(settings.moderatorPermissions);
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      send('patch', `/${c.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        enrolmentFeeNgn: Math.max(0, parseInt(fee || '0', 10) || 0),
        isPublic,
        isActive,
        showInCreatorListing: listed,
        settings: { postingPolicy: posting, postCategories: cats.split(',').map((s) => s.trim()).filter(Boolean), levelNames: levels, moderatorPermissions: perms },
      }),
    onSuccess: () => {
      setMsg(t('classroom.settings.saved', 'Settings saved'));
      void qc.invalidateQueries({ queryKey: ['classroom', c.id] });
    },
    onError: (e) => setMsg(apiError(e).message),
  });
  const check = 'flex items-center gap-2 text-sm';
  const permLabels: Record<keyof ModeratorPermissions, string> = {
    managePosts: t('classroom.settings.perm.managePosts', 'Pin, lock, hide and delete posts & comments'),
    manageMembers: t('classroom.settings.perm.manageMembers', 'Mute members'),
    manageEvents: t('classroom.settings.perm.manageEvents', 'Schedule live sessions and add recordings'),
    handleReports: t('classroom.settings.perm.handleReports', 'Review member reports'),
  };
  return (
    <div className="space-y-3">
      <div className={card}>
        <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <textarea className={field} rows={4} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        <label className="block text-xs text-neutral-500">
          {t('classroom.create.fee', 'Enrolment fee (Credits, 0 = free)')}
          <input type="number" min={0} className={field} value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
        <p className="text-[11px] text-neutral-500">{t('classroom.settings.feeHint', 'You receive 80% of each enrolment (85% for Icon creators). It lands in your creator balance and is withdrawn from the Classroom Studio.')}</p>
        <label className={check}><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />{t('classroom.settings.public', 'Public — listed in Discover and indexed by search engines')}</label>
        <label className={check}><input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />{t('classroom.create.showInListing', 'Show on my public “Classrooms by” page')}</label>
        <label className={check}><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />{t('classroom.settings.active', 'Active — accepting new members (uncheck to archive)')}</label>
      </div>
      <div className={card}>
        <select className={field} value={posting} onChange={(e) => setPosting(e.target.value as ClassroomSettings['postingPolicy'])}>
          <option value="members">{t('classroom.settings.posting.members', 'All members')}</option>
          <option value="moderators">{t('classroom.settings.posting.moderators', 'Only me and moderators')}</option>
        </select>
        <label className="block text-xs text-neutral-500">
          {t('classroom.settings.categories', 'Post categories (comma-separated)')}
          <input className={field} value={cats} onChange={(e) => setCats(e.target.value)} />
        </label>
      </div>
      <div className={card}>
        <p className="text-sm font-semibold">{t('classroom.settings.levels', 'Level names')}</p>
        {levels.map((n, i) => (
          <input key={i} className={field} value={n} maxLength={40} placeholder={t('classroom.level.number', 'Level {{level}}', { level: i + 1 })} onChange={(e) => setLevels(levels.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
      </div>
      <div className={card}>
        <p className="text-sm font-semibold">{t('classroom.settings.moderatorPerms', 'What moderators can do')}</p>
        {(Object.keys(permLabels) as Array<keyof ModeratorPermissions>).map((k) => (
          <label key={k} className={check}>
            <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />
            {permLabels[k]}
          </label>
        ))}
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      <button type="button" disabled={save.isPending || name.trim().length < 2} onClick={() => save.mutate()} className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {t('classroom.settings.save', 'Save settings')}
      </button>
    </div>
  );
}
