/**
 * apps/android/src/routes/admin/announcements.tsx
 *
 * Announcements — mirrors apps/web/app/(admin)/admin/announcements/page.tsx:
 * modal + banner announcements with scheduling, plan/role targeting, and a
 * per-type display mode (serial vs random).
 *
 * GET   /api/admin/announcements?type=modal|banner  → { announcements, displayMode }
 * POST  /api/admin/announcements                    { type, title, content, contentType,
 *                                                       linkUrl?, startsAt?, endsAt?,
 *                                                       targetPlans, targetRoles, displayOrder }
 * PUT   /api/admin/announcements/:id                 (partial, same field names)
 * PATCH /api/admin/announcements/:id                 { isActive }
 * DELETE /api/admin/announcements/:id
 * PUT   /api/admin/announcements/display-mode        { mode, type }
 *
 * CONTRACT FIX vs the web reference: the web page's create/update form posts
 * `{ status, audience: { plans, roles }, startAt, endAt }` and its display-mode
 * save omits `type` entirely — none of those match this endpoint's Zod schemas
 * (`targetPlans`/`targetRoles`/`startsAt`/`endsAt`, and display-mode's `type`
 * defaults to "modal" so the web page can never actually set the banner mode).
 * This page sends the real field names instead. It also always sends `title`
 * for banners — the CreateSchema requires `title` for both types, but the web
 * form only fills it in for modals, so creating a banner via web 400s.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminTabs,
  AdminBadge,
  AdminToast,
  AdminErrorState,
  AdminEmptyState,
  AdminCardSkeleton,
  AdminConfirmDialog,
  AdminField,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

type AnnType = 'modal' | 'banner';
type ContentType = 'html' | 'markdown' | 'plain';
type DisplayMode = 'serial' | 'random';

interface Announcement {
  id: string;
  title: string;
  content: string;
  content_type: ContentType;
  link_url?: string | null;
  is_active: boolean;
  target_plans: string[] | string | null;
  target_roles: string[] | string | null;
  display_order: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AnnouncementsResponse {
  announcements: Announcement[];
  displayMode: DisplayMode;
}

const PLAN_OPTIONS = ['free', 'basic', 'pro', 'vip'];
const ROLE_OPTIONS = ['user', 'creator', 'moderator', 'admin'];

function parseArr(v: string[] | string | null | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v) as unknown;
      return Array.isArray(p) ? (p as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toInputDate(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 16) : '';
}

async function fetchAnnouncements(type: AnnType): Promise<AnnouncementsResponse> {
  const { data } = await apiClient.get<AnnouncementsResponse>(`/admin/announcements?type=${type}`);
  return data;
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

interface AnnFormValues {
  title: string;
  content: string;
  contentType: ContentType;
  linkUrl: string;
  startsAt: string;
  endsAt: string;
  targetPlans: string[];
  targetRoles: string[];
  displayOrder: number;
}

function AnnForm({
  type,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  type: AnnType;
  initial?: Partial<Announcement>;
  saving: boolean;
  onSave: (values: AnnFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [linkUrl, setLinkUrl] = useState(initial?.link_url ?? '');
  const [startsAt, setStartsAt] = useState(toInputDate(initial?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toInputDate(initial?.ends_at ?? null));
  const [targetPlans, setTargetPlans] = useState<string[]>(parseArr(initial?.target_plans));
  const [targetRoles, setTargetRoles] = useState<string[]>(parseArr(initial?.target_roles));
  const [displayOrder, setDisplayOrder] = useState(initial?.display_order ?? 0);

  const toggle = (list: string[], setList: (v: string[]) => void, val: string) =>
    setList(list.includes(val) ? list.filter((v) => v !== val) : [...list, val]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, content, contentType: 'plain', linkUrl, startsAt, endsAt, targetPlans, targetRoles, displayOrder });
      }}
      className="space-y-3.5 rounded-xl border border-blue-200 bg-blue-50 p-4"
    >
      <AdminField label={t('admin.announcements.form.title', 'Title')}>
        <input required value={title} onChange={(e) => setTitle(e.target.value)} className={adminInputClass} placeholder={t('admin.announcements.form.titlePlaceholder', 'Announcement title')} />
      </AdminField>

      <AdminField label={t('admin.announcements.form.content', 'Content')}>
        <textarea required rows={4} value={content} onChange={(e) => setContent(e.target.value)} className={`${adminInputClass} resize-y`} placeholder={t('admin.announcements.form.contentPlaceholder', 'HTML or plain text content…')} />
      </AdminField>

      {type === 'banner' && (
        <AdminField label={t('admin.announcements.form.linkUrl', 'Link URL (optional)')}>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className={adminInputClass} placeholder="https://…" />
        </AdminField>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <AdminField label={t('admin.announcements.form.start', 'Start')}>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={adminInputClass} />
        </AdminField>
        <AdminField label={t('admin.announcements.form.end', 'End')}>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={adminInputClass} />
        </AdminField>
      </div>

      {type === 'modal' && (
        <AdminField label={t('admin.announcements.form.displayOrder', 'Display Order (1–5)')}>
          <input type="number" min={0} max={5} value={displayOrder} onChange={(e) => setDisplayOrder(Number(e.target.value))} className={`${adminInputClass} w-24`} />
        </AdminField>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold text-neutral-700">{t('admin.announcements.form.plans', 'Plans')}</p>
        <div className="flex flex-wrap gap-2">
          {PLAN_OPTIONS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={targetPlans.includes(p)} onChange={() => toggle(targetPlans, setTargetPlans, p)} className="rounded border-neutral-300" />
              {p}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-neutral-700">{t('admin.announcements.form.roles', 'Roles')}</p>
        <div className="flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={targetRoles.includes(r)} onChange={() => toggle(targetRoles, setTargetRoles, r)} className="rounded border-neutral-300" />
              {r}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? '…' : t('common.confirm', 'Save')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700">
          {t('common.cancel', 'Cancel')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function AnnRow({
  ann,
  busy,
  onToggle,
  onDelete,
  onEdit,
}: {
  ann: Announcement;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const plans = parseArr(ann.target_plans);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
      <p className="truncate font-semibold text-neutral-900">{ann.title}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{ann.content.slice(0, 120)}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
        <AdminBadge label={ann.is_active ? t('admin.announcements.active', 'Active') : t('admin.announcements.inactive', 'Inactive')} color={ann.is_active ? 'green' : 'neutral'} />
        {plans.length > 0 && <span>{t('admin.announcements.form.plans', 'Plans')}: {plans.join(', ')}</span>}
        <span>{fmtDate(ann.starts_at)} — {fmtDate(ann.ends_at)}</span>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <button type="button" onClick={onEdit} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
          {t('admin.config.edit', 'Edit')}
        </button>
        <button type="button" disabled={busy} onClick={onToggle} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
          {busy ? '…' : ann.is_active ? t('admin.announcements.deactivate', 'Deactivate') : t('admin.announcements.activate', 'Activate')}
        </button>
        <button type="button" disabled={busy} onClick={onDelete} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
          {t('admin.rooms.delete', 'Delete')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function AdminAnnouncementsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<AnnType>('modal');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'announcements', tab], queryFn: () => fetchAnnouncements(tab) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'announcements', tab] });

  const createMutation = useMutation({
    mutationFn: (values: AnnFormValues) =>
      apiClient.post('/admin/announcements', {
        type: tab,
        title: values.title,
        content: values.content,
        contentType: values.contentType,
        ...(tab === 'banner' ? { linkUrl: values.linkUrl || null } : {}),
        startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
        endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
        targetPlans: values.targetPlans,
        targetRoles: values.targetRoles,
        displayOrder: values.displayOrder,
      }),
    onSuccess: () => { showToast(t('admin.announcements.created', 'Announcement created')); setCreating(false); invalidate(); },
    onError: () => showToast(t('admin.announcements.createFailed', 'Failed to create'), 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: AnnFormValues }) =>
      apiClient.put(`/admin/announcements/${id}`, {
        title: values.title,
        content: values.content,
        contentType: values.contentType,
        ...(tab === 'banner' ? { linkUrl: values.linkUrl || null } : {}),
        startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
        endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
        targetPlans: values.targetPlans,
        targetRoles: values.targetRoles,
        displayOrder: values.displayOrder,
      }),
    onSuccess: () => { showToast(t('admin.announcements.updated', 'Announcement updated')); setEditing(null); invalidate(); },
    onError: () => showToast(t('admin.announcements.updateFailed', 'Failed to update'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiClient.patch(`/admin/announcements/${id}`, { isActive }),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: () => { showToast(t('admin.announcements.statusUpdated', 'Status updated')); invalidate(); },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
    onSettled: () => setBusyId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/announcements/${id}`),
    onSuccess: () => { showToast(t('admin.announcements.deleted', 'Deleted')); setDeleteId(null); invalidate(); },
    onError: () => showToast(t('admin.announcements.deleteFailed', 'Failed to delete'), 'error'),
  });

  const displayModeMutation = useMutation({
    mutationFn: (mode: DisplayMode) => apiClient.put('/admin/announcements/display-mode', { mode, type: tab }),
    onMutate: async (mode) => {
      await qc.cancelQueries({ queryKey: ['admin', 'announcements', tab] });
      const prev = qc.getQueryData<AnnouncementsResponse>(['admin', 'announcements', tab]);
      qc.setQueryData<AnnouncementsResponse>(['admin', 'announcements', tab], (old) => (old ? { ...old, displayMode: mode } : old));
      return { prev };
    },
    onError: (_err, _mode, ctx) => { if (ctx?.prev) qc.setQueryData(['admin', 'announcements', tab], ctx.prev); },
    onSuccess: () => showToast(t('admin.announcements.displayModeSaved', 'Display mode saved')),
  });

  const annType: AnnType = tab;
  const maxSlots = tab === 'modal' ? 5 : Infinity;
  const canCreate = (data?.announcements.length ?? 0) < maxSlots;

  const tabs = [
    { key: 'modal' as const, label: t('admin.announcements.tab.modals', 'Modals') },
    { key: 'banner' as const, label: t('admin.announcements.tab.banners', 'Banners') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.announcements', 'Announcements')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs tabs={tabs} active={tab} onChange={(k) => { setTab(k); setCreating(false); setEditing(null); }} />

      {status === 'success' && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-card">
          <p className="text-xs font-semibold text-neutral-700">{t('admin.announcements.displayMode', 'Display Mode')}</p>
          <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-100 p-0.5">
            {(['serial', 'random'] as DisplayMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => displayModeMutation.mutate(m)}
                className={`rounded px-2.5 py-1 text-xs font-semibold capitalize ${data.displayMode === m ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}

        {status === 'success' && data.announcements.length === 0 && !creating && (
          <AdminEmptyState icon="📢" title={t('admin.announcements.empty', 'No {{tab}} yet', { tab })} />
        )}

        {status === 'success' &&
          data.announcements.map((ann) =>
            editing?.id === ann.id ? (
              <AnnForm
                key={ann.id}
                type={annType}
                initial={ann}
                saving={updateMutation.isPending}
                onSave={(values) => updateMutation.mutate({ id: ann.id, values })}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <AnnRow
                key={ann.id}
                ann={ann}
                busy={busyId === ann.id}
                onToggle={() => toggleMutation.mutate({ id: ann.id, isActive: !ann.is_active })}
                onDelete={() => setDeleteId(ann.id)}
                onEdit={() => setEditing(ann)}
              />
            ),
          )}
      </div>

      {creating ? (
        <div className="mt-3">
          <AnnForm type={annType} saving={createMutation.isPending} onSave={(values) => createMutation.mutate(values)} onCancel={() => setCreating(false)} />
        </div>
      ) : (
        status === 'success' && (
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => setCreating(true)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-300 px-5 py-4 text-sm font-semibold text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + {tab === 'modal' ? t('admin.announcements.createModal', 'Create Modal') : t('admin.announcements.createBanner', 'Create Banner')}
            {tab === 'modal' && <span className="text-xs font-normal text-neutral-400">({data?.announcements.length ?? 0}/5)</span>}
          </button>
        )
      )}

      {deleteId && (
        <AdminConfirmDialog
          title={t('admin.announcements.confirmDeleteTitle', 'Delete this announcement?')}
          description={t('admin.announcements.confirmDeleteDesc', 'This cannot be undone.')}
          confirmLabel={t('admin.rooms.delete', 'Delete')}
          cancelLabel={t('common.cancel', 'Cancel')}
          danger
          pending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/announcements')({
  component: AdminAnnouncementsPage,
});
