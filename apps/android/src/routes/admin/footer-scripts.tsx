/**
 * apps/android/src/routes/admin/footer-scripts.tsx
 *
 * Footer Script Manager — mirrors apps/web/app/(admin)/admin/footer-scripts/page.tsx:
 * view, create, edit, toggle, and delete scripts injected server-side into
 * the site footer (analytics, chat widgets, third-party integrations).
 *
 * GET    /api/admin/footer-scripts          → { scripts }
 * POST   /api/admin/footer-scripts          { name, content, isActive?, position? } → { script }
 * PATCH  /api/admin/footer-scripts/:id      (partial) → { script }
 * DELETE /api/admin/footer-scripts/:id
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminBadge,
  AdminToast,
  AdminErrorState,
  AdminEmptyState,
  AdminCardSkeleton,
  AdminConfirmDialog,
  AdminField,
  adminInputClass,
} from '@/components/admin/AdminUI';

interface FooterScript {
  id: string;
  name: string;
  content: string;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface ScriptFormValues {
  name: string;
  content: string;
  isActive: boolean;
  position: number;
}

async function fetchScripts(): Promise<FooterScript[]> {
  const { data } = await apiClient.get<{ scripts: FooterScript[] }>('/admin/footer-scripts');
  return data?.scripts ?? [];
}

function ScriptForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial?: Partial<FooterScript>;
  saving: boolean;
  onSave: (values: ScriptFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [position, setPosition] = useState(initial?.position ?? 0);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ name, content, isActive, position }); }}
      className="space-y-3.5 rounded-xl border border-blue-200 bg-blue-50 p-4"
    >
      <h3 className="text-sm font-bold text-neutral-800">
        {initial?.id ? t('admin.footerScripts.editTitle', 'Edit Script') : t('admin.footerScripts.newTitle', 'New Footer Script')}
      </h3>

      <AdminField label={t('admin.footerScripts.name', 'Name')}>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={adminInputClass} placeholder={t('admin.footerScripts.namePlaceholder', 'e.g. Google Analytics, Intercom')} />
      </AdminField>

      <AdminField label={t('admin.footerScripts.content', 'Content')}>
        <textarea
          required
          rows={7}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={`${adminInputClass} resize-y font-mono text-xs`}
          placeholder={'<script>\n  // Your script here\n</script>'}
        />
        <p className="mt-1 text-[11px] text-neutral-400">
          {t('admin.footerScripts.contentHint', 'HTML, JS, or CSS injected into the site footer server-side. Admin-only. Content is sanitised.')}
        </p>
      </AdminField>

      <div className="flex flex-wrap items-center gap-5">
        <AdminField label={t('admin.footerScripts.position', 'Position')}>
          <input type="number" min={0} value={position} onChange={(e) => setPosition(Number(e.target.value))} className={`${adminInputClass} w-24`} />
        </AdminField>
        <label className="flex items-center gap-2 pt-4 text-sm font-medium text-neutral-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
          {t('admin.footerScripts.active', 'Active')}
        </label>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? '…' : t('admin.footerScripts.save', 'Save Script')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700">
          {t('common.cancel', 'Cancel')}
        </button>
      </div>
    </form>
  );
}

function ScriptCard({
  script,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  script: FooterScript;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const preview = script.content.slice(0, 80) + (script.content.length > 80 ? '…' : '');
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="font-semibold text-neutral-900">{script.name}</p>
        <AdminBadge label={script.isActive ? t('admin.announcements.active', 'Active') : t('admin.announcements.inactive', 'Inactive')} color={script.isActive ? 'green' : 'neutral'} />
        <span className="ml-auto text-[11px] text-neutral-400">{t('admin.footerScripts.position', 'Position')}: {script.position}</span>
      </div>
      <p className="mt-1.5 truncate font-mono text-[11px] text-neutral-500" title={script.content}>{preview}</p>
      <div className="mt-2.5 flex gap-1.5">
        <button type="button" onClick={onEdit} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
          {t('admin.config.edit', 'Edit')}
        </button>
        <button type="button" disabled={busy} onClick={onToggle} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
          {busy ? '…' : script.isActive ? t('admin.announcements.deactivate', 'Deactivate') : t('admin.announcements.activate', 'Activate')}
        </button>
        <button type="button" disabled={busy} onClick={onDelete} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50">
          {t('admin.rooms.delete', 'Delete')}
        </button>
      </div>
    </div>
  );
}

function AdminFooterScriptsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FooterScript | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'footer-scripts'], queryFn: fetchScripts });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'footer-scripts'] });

  const createMutation = useMutation({
    mutationFn: (values: ScriptFormValues) => apiClient.post('/admin/footer-scripts', values),
    onSuccess: () => { showToast(t('admin.footerScripts.created', 'Script created')); setCreating(false); invalidate(); },
    onError: () => showToast(t('admin.footerScripts.createFailed', 'Failed to create script'), 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ScriptFormValues }) => apiClient.patch(`/admin/footer-scripts/${id}`, values),
    onSuccess: () => { showToast(t('admin.footerScripts.updated', 'Script updated')); setEditing(null); invalidate(); },
    onError: () => showToast(t('admin.footerScripts.updateFailed', 'Failed to update script'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiClient.patch(`/admin/footer-scripts/${id}`, { isActive }),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: (_res, { isActive }) => showToast(isActive ? t('admin.footerScripts.activated', 'Script activated') : t('admin.footerScripts.deactivated', 'Script deactivated')),
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
    onSettled: () => { setBusyId(null); invalidate(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/footer-scripts/${id}`),
    onSuccess: () => { showToast(t('admin.footerScripts.deleted', 'Script deleted')); setDeleteId(null); invalidate(); },
    onError: () => showToast(t('admin.footerScripts.deleteFailed', 'Failed to delete script'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.footerScripts', 'Footer Scripts')}</h1>
        {!creating && !editing && (
          <button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white">
            + {t('admin.footerScripts.newTitle', 'New Script')}
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-neutral-500">{t('admin.footerScripts.subtitle', 'Manage scripts injected into the site footer. Useful for analytics, chat widgets, and third-party integrations.')}</p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      {creating && (
        <div className="mb-4">
          <ScriptForm saving={createMutation.isPending} onSave={(values) => createMutation.mutate(values)} onCancel={() => setCreating(false)} />
        </div>
      )}

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}

        {status === 'success' && data.length === 0 && !creating && (
          <AdminEmptyState icon="📄" title={t('admin.footerScripts.empty', 'No footer scripts yet')} hint={t('admin.footerScripts.emptyHint', 'Tap "New Script" to add one.')} />
        )}

        {status === 'success' &&
          data.map((script) =>
            editing?.id === script.id ? (
              <ScriptForm
                key={script.id}
                initial={script}
                saving={updateMutation.isPending}
                onSave={(values) => updateMutation.mutate({ id: script.id, values })}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <ScriptCard
                key={script.id}
                script={script}
                busy={busyId === script.id}
                onEdit={() => setEditing(script)}
                onToggle={() => toggleMutation.mutate({ id: script.id, isActive: !script.isActive })}
                onDelete={() => setDeleteId(script.id)}
              />
            ),
          )}
      </div>

      {deleteId && (
        <AdminConfirmDialog
          title={t('admin.footerScripts.confirmDeleteTitle', 'Delete this footer script?')}
          description={t('admin.footerScripts.confirmDeleteDesc', 'This cannot be undone.')}
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

export const Route = createFileRoute('/admin/footer-scripts')({
  component: AdminFooterScriptsPage,
});
