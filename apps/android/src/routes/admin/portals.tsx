/**
 * apps/android/src/routes/admin/portals.tsx
 *
 * Portals admin — mirrors apps/web/app/(admin)/gate44/portals/page.tsx using
 * the AdminUI kit like routes/admin/polls.tsx. Two tabs:
 *  - Portals: status filter + search; create official portals; edit copy,
 *    cover, accent, place keyword, forum board, sections (order/visibility),
 *    pinning, the feed boost dial (0-100 + schedule) and sponsorship; promote /
 *    suppress / restore / delete; 30-day analytics in the editor.
 *  - Hashtags: explore, make portal, merge, block / unblock.
 *
 * GET/POST /api/admin/portals, GET/PATCH/DELETE /api/admin/portals/:id,
 * GET/POST /api/admin/portals/hashtags.
 */

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { PORTAL_SECTION_KEYS } from '@zobia/shared/utils';
import type { PortalSectionConfig, PortalStatus } from '@zobia/shared/types';
import {
  AdminBadge,
  AdminCard,
  AdminCardSkeleton,
  AdminConfirmDialog,
  AdminEmptyState,
  AdminErrorState,
  AdminField,
  AdminTabs,
  AdminToast,
  adminInputClass,
} from '@/components/admin/AdminUI';

interface AdminPortal {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  coverImageUrl: string | null;
  accentColor: string | null;
  city: string | null;
  bbBoardId: string | null;
  status: PortalStatus;
  sections: PortalSectionConfig[];
  isPinned: boolean;
  boostWeight: number;
  boostStartsAt: string | null;
  boostEndsAt: string | null;
  sponsoredUntil: string | null;
  sponsorName: string | null;
  followerCount: number;
  activityCount: number;
}

interface HashtagRow {
  slug: string;
  useCount: number;
  isBlocked: boolean;
  aliasOf: string | null;
  hasPortal: boolean;
}

interface Stats {
  totals: { views: number; impressions: number; clicks: number; follows: number };
}

interface FormState {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  coverImageUrl: string;
  accentColor: string;
  city: string;
  bbBoardId: string;
  sections: PortalSectionConfig[];
  isPinned: boolean;
  boostWeight: number;
  boostStartsAt: string;
  boostEndsAt: string;
  sponsorName: string;
  sponsoredUntil: string;
}

const STATUS_COLOR: Record<PortalStatus, 'green' | 'gold' | 'red' | 'neutral'> = {
  official: 'green',
  auto: 'gold',
  archived: 'neutral',
  suppressed: 'red',
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

function emptyForm(slug = ''): FormState {
  return {
    slug,
    title: '',
    tagline: '',
    description: '',
    coverImageUrl: '',
    accentColor: '',
    city: '',
    bbBoardId: '',
    sections: PORTAL_SECTION_KEYS.map((key) => ({ key, enabled: true })),
    isPinned: false,
    boostWeight: 0,
    boostStartsAt: '',
    boostEndsAt: '',
    sponsorName: '',
    sponsoredUntil: '',
  };
}

function formFrom(p: AdminPortal): FormState {
  return {
    slug: p.slug,
    title: p.title,
    tagline: p.tagline ?? '',
    description: p.description ?? '',
    coverImageUrl: p.coverImageUrl ?? '',
    accentColor: p.accentColor ?? '',
    city: p.city ?? '',
    bbBoardId: p.bbBoardId ?? '',
    sections: p.sections,
    isPinned: p.isPinned,
    boostWeight: p.boostWeight,
    boostStartsAt: toLocalInput(p.boostStartsAt),
    boostEndsAt: toLocalInput(p.boostEndsAt),
    sponsorName: p.sponsorName ?? '',
    sponsoredUntil: toLocalInput(p.sponsoredUntil),
  };
}

function bodyFrom(f: FormState) {
  return {
    title: f.title.trim() || undefined,
    tagline: f.tagline.trim() || null,
    description: f.description.trim() || null,
    coverImageUrl: f.coverImageUrl.trim() || null,
    accentColor: f.accentColor.trim() || null,
    city: f.city.trim() || null,
    bbBoardId: f.bbBoardId.trim() || null,
    sections: f.sections,
    isPinned: f.isPinned,
    boostWeight: f.boostWeight,
    boostStartsAt: fromLocalInput(f.boostStartsAt),
    boostEndsAt: fromLocalInput(f.boostEndsAt),
    sponsorName: f.sponsorName.trim() || null,
    sponsoredUntil: fromLocalInput(f.sponsoredUntil),
  };
}

function errMessage(e: unknown, fallback: string): string {
  if (isAxiosError(e)) {
    const err = e.response?.data?.error;
    if (typeof err === 'string') return err;
    if (err?.issues?.[0]?.message) return err.issues[0].message;
    if (err?.message) return err.message;
  }
  return fallback;
}

type Tab = 'portals' | 'hashtags';
type StatusFilter = 'all' | PortalStatus;

function AdminPortalsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('portals');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [dq, setDq] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [deleting, setDeleting] = useState<AdminPortal | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const h = setTimeout(() => setDq(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  const portals = useQuery({
    queryKey: ['admin', 'portals', status, dq],
    enabled: tab === 'portals',
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100', sort: 'new' });
      if (status !== 'all') params.set('status', status);
      if (dq) params.set('q', dq);
      return (await apiClient.get<{ portals: AdminPortal[]; total: number }>(`/admin/portals?${params}`)).data;
    },
  });

  const stats = useQuery({
    queryKey: ['admin', 'portals', 'stats', editing?.id],
    enabled: !!editing?.id,
    queryFn: async () => (await apiClient.get<{ stats: Stats }>(`/admin/portals/${editing!.id}`)).data?.stats ?? null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'portals'] });

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiClient.patch(`/admin/portals/${id}`, body),
    onSuccess: () => {
      showToast(t('admin.portals.saved', 'Portal saved'));
      setEditing(null);
      void refresh();
    },
    onError: (e) => showToast(errMessage(e, t('admin.portals.actionFailed', 'Action failed')), 'error'),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/admin/portals', body),
    onSuccess: () => {
      showToast(t('admin.portals.saved', 'Portal saved'));
      setEditing(null);
      void refresh();
    },
    onError: (e) => showToast(errMessage(e, t('admin.portals.actionFailed', 'Action failed')), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/portals/${id}`),
    onSuccess: () => {
      showToast(t('admin.portals.deleted', 'Portal deleted'));
      setDeleting(null);
      void refresh();
    },
    onError: (e) => showToast(errMessage(e, t('admin.portals.actionFailed', 'Action failed')), 'error'),
  });

  // ---- Hashtags ----------------------------------------------------------
  const [tagSearch, setTagSearch] = useState('');
  const [dtq, setDtq] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [merging, setMerging] = useState<HashtagRow | null>(null);
  const [mergeInto, setMergeInto] = useState('');
  const [blocking, setBlocking] = useState<HashtagRow | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDtq(tagSearch.trim()), 300);
    return () => clearTimeout(h);
  }, [tagSearch]);

  const tags = useQuery({
    queryKey: ['admin', 'portals', 'hashtags', dtq, blockedOnly],
    enabled: tab === 'hashtags',
    queryFn: async () => {
      const params = new URLSearchParams({ blocked: blockedOnly ? '1' : '0', limit: '60' });
      if (dtq) params.set('q', dtq);
      return (await apiClient.get<{ hashtags: HashtagRow[] }>(`/admin/portals/hashtags?${params}`)).data?.hashtags ?? [];
    },
  });

  const tagMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/admin/portals/hashtags', body),
    onSuccess: () => {
      showToast(t('admin.portals.saved', 'Saved'));
      setMerging(null);
      setBlocking(null);
      void refresh();
    },
    onError: (e) => showToast(errMessage(e, t('admin.portals.actionFailed', 'Action failed')), 'error'),
  });

  const moveSection = (idx: number, dir: -1 | 1) =>
    setEditing((prev) => {
      if (!prev) return prev;
      const next = [...prev.form.sections];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...prev, form: { ...prev.form, sections: next } };
    });

  const setForm = (patch: Partial<FormState>) => setEditing((prev) => (prev ? { ...prev, form: { ...prev.form, ...patch } } : prev));

  const save = () => {
    if (!editing) return;
    const body = bodyFrom(editing.form);
    if (editing.id) patchMutation.mutate({ id: editing.id, body });
    else createMutation.mutate({ slug: editing.form.slug, ...body });
  };

  const statusTabs = (['all', 'official', 'auto', 'archived', 'suppressed'] as StatusFilter[]).map((s) => ({
    key: s,
    label: s === 'all' ? t('admin.polls.tab.all', 'All') : s.charAt(0).toUpperCase() + s.slice(1),
  }));

  return (
    <div className="px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.portals.title', 'Portals')}</h1>
        <button
          onClick={() => setEditing({ id: null, form: emptyForm() })}
          className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white"
        >
          {t('admin.portals.new', 'New official portal')}
        </button>
      </div>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs
        tabs={[
          { key: 'portals', label: t('admin.portals.tab.portals', 'Portals') },
          { key: 'hashtags', label: t('admin.portals.tab.hashtags', 'Hashtags') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'portals' && (
        <>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.portals.search', 'Search tag or title…')}
            className={`${adminInputClass} mb-3`}
          />
          <AdminTabs tabs={statusTabs} active={status} onChange={setStatus} />

          <div className="space-y-2.5">
            {portals.status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
            {portals.status === 'error' && <AdminErrorState onRetry={() => portals.refetch()} />}
            {portals.status === 'success' && (portals.data?.portals.length ?? 0) === 0 && (
              <AdminEmptyState icon="🧭" title={t('admin.portals.empty', 'No portals yet.')} />
            )}
            {portals.status === 'success' &&
              portals.data?.portals.map((p) => (
                <AdminCard key={p.id}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">#{p.slug}</p>
                    <AdminBadge label={p.status} color={STATUS_COLOR[p.status]} />
                    {p.isPinned && <span>📌</span>}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {p.title} · {p.followerCount} {t('admin.portals.col.followers', 'Followers')} · {p.activityCount} {t('admin.portals.col.activity', 'Activity')}
                    {p.boostWeight > 0 ? ` · ${t('admin.portals.col.boost', 'Boost')} ${p.boostWeight}` : ''}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button onClick={() => setEditing({ id: p.id, form: formFrom(p) })} className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      {t('admin.portals.edit', 'Edit')}
                    </button>
                    {p.status === 'auto' && (
                      <button onClick={() => patchMutation.mutate({ id: p.id, body: { status: 'official' } })} className="rounded-lg bg-success-100 dark:bg-success-900/40 px-2.5 py-1 text-xs font-semibold text-success-700 dark:text-success-300">
                        {t('admin.portals.promote', 'Promote')}
                      </button>
                    )}
                    {(p.status === 'archived' || p.status === 'suppressed') && (
                      <button onClick={() => patchMutation.mutate({ id: p.id, body: { status: 'auto' } })} className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        {t('admin.portals.restore', 'Restore')}
                      </button>
                    )}
                    {p.status !== 'suppressed' && (
                      <button onClick={() => patchMutation.mutate({ id: p.id, body: { status: 'suppressed' } })} className="rounded-lg bg-danger-100 dark:bg-danger-900/40 px-2.5 py-1 text-xs font-semibold text-danger-700 dark:text-danger-300">
                        {t('admin.portals.suppress', 'Suppress')}
                      </button>
                    )}
                    <button onClick={() => setDeleting(p)} className="rounded-lg bg-danger-100 dark:bg-danger-900/40 px-2.5 py-1 text-xs font-semibold text-danger-700 dark:text-danger-300">
                      {t('admin.portals.delete', 'Delete')}
                    </button>
                  </div>
                </AdminCard>
              ))}
          </div>
        </>
      )}

      {tab === 'hashtags' && (
        <>
          <input
            type="search"
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
            placeholder={t('admin.portals.tagSearch', 'Search hashtags…')}
            className={`${adminInputClass} mb-3`}
          />
          <label className="mb-3 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} /> {t('admin.portals.blockedOnly', 'Blocked only')}
          </label>
          <div className="space-y-2.5">
            {tags.status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
            {tags.status === 'error' && <AdminErrorState onRetry={() => tags.refetch()} />}
            {tags.status === 'success' && (tags.data?.length ?? 0) === 0 && <AdminEmptyState icon="#️⃣" title={t('admin.portals.noTags', 'No hashtags.')} />}
            {tags.status === 'success' &&
              tags.data?.map((h) => (
                <AdminCard key={h.slug}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900 dark:text-neutral-100">#{h.slug}</p>
                    {h.aliasOf && <AdminBadge label={t('admin.portals.merged', 'merged')} color="neutral" />}
                    {h.hasPortal && <AdminBadge label="portal" color="green" />}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{h.useCount} {t('admin.portals.col.uses', 'Uses')}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {!h.isBlocked && !h.aliasOf && (
                      <button onClick={() => setEditing({ id: null, form: emptyForm(h.slug) })} className="rounded-lg bg-success-100 dark:bg-success-900/40 px-2.5 py-1 text-xs font-semibold text-success-700 dark:text-success-300">
                        {t('admin.portals.makePortal', 'Make portal')}
                      </button>
                    )}
                    {!h.isBlocked && !h.aliasOf && (
                      <button onClick={() => { setMerging(h); setMergeInto(''); }} className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        {t('admin.portals.merge', 'Merge into…')}
                      </button>
                    )}
                    {h.isBlocked ? (
                      <button onClick={() => tagMutation.mutate({ action: 'unblock', slug: h.slug })} className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        {t('admin.portals.unblock', 'Unblock')}
                      </button>
                    ) : (
                      <button onClick={() => setBlocking(h)} className="rounded-lg bg-danger-100 dark:bg-danger-900/40 px-2.5 py-1 text-xs font-semibold text-danger-700 dark:text-danger-300">
                        {t('admin.portals.block', 'Block')}
                      </button>
                    )}
                  </div>
                </AdminCard>
              ))}
          </div>
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white dark:bg-neutral-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                {editing.id ? t('admin.portals.editTitle', 'Edit portal #{{slug}}', { slug: editing.form.slug }) : t('admin.portals.newTitle', 'New official portal')}
              </h2>
              <button onClick={() => setEditing(null)} aria-label={t('common.cancel', 'Cancel')} className="text-neutral-400">✕</button>
            </div>

            {stats.data && (
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {(['views', 'impressions', 'clicks', 'follows'] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-neutral-100 dark:bg-neutral-700 p-2">
                    <div className="text-base font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{stats.data!.totals[k]}</div>
                    <div className="text-neutral-500">{t(`admin.portals.stat.${k}`, k)}</div>
                  </div>
                ))}
              </div>
            )}

            <AdminField label={t('admin.portals.field.slug', 'Hashtag (slug)')}>
              <input className={adminInputClass} value={editing.form.slug} disabled={!!editing.id} onChange={(e) => setForm({ slug: e.target.value.replace(/^#/, '') })} placeholder="lagos" />
            </AdminField>
            <AdminField label={t('admin.portals.field.title', 'Title')}>
              <input className={adminInputClass} maxLength={80} value={editing.form.title} onChange={(e) => setForm({ title: e.target.value })} />
            </AdminField>
            <AdminField label={t('admin.portals.field.tagline', 'Tagline')}>
              <input className={adminInputClass} maxLength={160} value={editing.form.tagline} onChange={(e) => setForm({ tagline: e.target.value })} />
            </AdminField>
            <AdminField label={t('admin.portals.field.description', 'Description')}>
              <textarea className={adminInputClass} rows={3} maxLength={1200} value={editing.form.description} onChange={(e) => setForm({ description: e.target.value })} />
            </AdminField>
            <AdminField label={t('admin.portals.field.cover', 'Cover image URL')}>
              <input className={adminInputClass} value={editing.form.coverImageUrl} onChange={(e) => setForm({ coverImageUrl: e.target.value })} placeholder="https://…" />
            </AdminField>
            <AdminField label={t('admin.portals.field.accent', 'Accent colour')}>
              <input className={adminInputClass} value={editing.form.accentColor} onChange={(e) => setForm({ accentColor: e.target.value })} placeholder="#0d9488" />
            </AdminField>
            <AdminField label={t('admin.portals.field.city', 'Place / school keyword')}>
              <input className={adminInputClass} maxLength={80} value={editing.form.city} onChange={(e) => setForm({ city: e.target.value })} />
            </AdminField>
            <AdminField label={t('admin.portals.field.board', 'Official forum board ID')}>
              <input className={adminInputClass} value={editing.form.bbBoardId} onChange={(e) => setForm({ bbBoardId: e.target.value })} placeholder="uuid (optional)" />
            </AdminField>

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-400">{t('admin.portals.field.sections', 'Sections (order and visibility)')}</legend>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-700 rounded-lg border border-neutral-200 dark:border-neutral-600">
                {editing.form.sections.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => setForm({ sections: editing.form.sections.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} />
                    <span className="flex-1 text-neutral-800 dark:text-neutral-200">{t(`portals.section.${s.key}`, s.key)}</span>
                    <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0} className="px-1 text-neutral-500 disabled:opacity-30" aria-label="Move up">↑</button>
                    <button type="button" onClick={() => moveSection(i, 1)} disabled={i === editing.form.sections.length - 1} className="px-1 text-neutral-500 disabled:opacity-30" aria-label="Move down">↓</button>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div className="rounded-lg border border-neutral-200 dark:border-neutral-600 p-3 space-y-3">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('admin.portals.field.boostTitle', 'Feed prominence')}</p>
              <label className="block text-sm text-neutral-700 dark:text-neutral-300">
                <span className="mb-1 block">{t('admin.portals.field.boost', 'Boost weight')}: <strong className="tabular-nums">{editing.form.boostWeight}</strong> / 100</span>
                <input type="range" min={0} max={100} step={5} className="w-full" value={editing.form.boostWeight} onChange={(e) => setForm({ boostWeight: Number(e.target.value) })} />
                <span className="text-xs text-neutral-500">{t('admin.portals.field.boostHint', '0 = organic only. 100 = shown up to ~11x more often in feed suggestions.')}</span>
              </label>
              <AdminField label={t('admin.portals.field.boostStart', 'Boost starts')}>
                <input type="datetime-local" className={adminInputClass} value={editing.form.boostStartsAt} onChange={(e) => setForm({ boostStartsAt: e.target.value })} />
              </AdminField>
              <AdminField label={t('admin.portals.field.boostEnd', 'Boost ends')}>
                <input type="datetime-local" className={adminInputClass} value={editing.form.boostEndsAt} onChange={(e) => setForm({ boostEndsAt: e.target.value })} />
              </AdminField>
              <AdminField label={t('admin.portals.field.sponsor', 'Sponsor name')}>
                <input className={adminInputClass} maxLength={80} value={editing.form.sponsorName} onChange={(e) => setForm({ sponsorName: e.target.value })} />
              </AdminField>
              <AdminField label={t('admin.portals.field.sponsorUntil', 'Sponsored until')}>
                <input type="datetime-local" className={adminInputClass} value={editing.form.sponsoredUntil} onChange={(e) => setForm({ sponsoredUntil: e.target.value })} />
              </AdminField>
              <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <input type="checkbox" checked={editing.form.isPinned} onChange={(e) => setForm({ isPinned: e.target.checked })} /> {t('admin.portals.field.pinned', 'Pinned (2x suggestion weight, never auto-archived)')}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">{t('common.cancel', 'Cancel')}</button>
              <button
                onClick={save}
                disabled={patchMutation.isPending || createMutation.isPending || (!editing.id && editing.form.slug.trim().length < 2)}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {patchMutation.isPending || createMutation.isPending ? t('action.saving', 'Saving…') : t('action.save', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <AdminConfirmDialog
          title={t('admin.portals.confirmDelete', 'Delete the #{{slug}} portal? The hashtag and its posts stay.', { slug: deleting.slug })}
          description={t('admin.blogs.confirmDeleteDesc', 'This cannot be undone.')}
          confirmLabel={t('admin.portals.delete', 'Delete')}
          cancelLabel={t('common.cancel')}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
        />
      )}

      {blocking && (
        <AdminConfirmDialog
          title={t('admin.portals.confirmBlock', 'Block #{{slug}}? Its links are removed and its portal suppressed.', { slug: blocking.slug })}
          description=""
          confirmLabel={t('admin.portals.block', 'Block')}
          cancelLabel={t('common.cancel')}
          danger
          pending={tagMutation.isPending}
          onCancel={() => setBlocking(null)}
          onConfirm={() => tagMutation.mutate({ action: 'block', slug: blocking.slug })}
        />
      )}

      {merging && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" role="dialog" aria-modal="true">
          <div className="w-full rounded-t-2xl bg-white dark:bg-neutral-800 p-4 space-y-3">
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{t('admin.portals.mergePrompt', 'Merge #{{slug}} into which hashtag? (without #)', { slug: merging.slug })}</h2>
            <input className={adminInputClass} value={mergeInto} onChange={(e) => setMergeInto(e.target.value.replace(/^#/, ''))} placeholder="uniben" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setMerging(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">{t('common.cancel', 'Cancel')}</button>
              <button
                onClick={() => tagMutation.mutate({ action: 'merge', slug: merging.slug, into: mergeInto })}
                disabled={mergeInto.trim().length < 2 || tagMutation.isPending}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('admin.portals.merge', 'Merge into…')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/portals')({
  component: AdminPortalsPage,
});
