/**
 * apps/android/src/routes/admin/help-center.tsx
 *
 * Help Center CMS admin — mirrors apps/web/app/(admin)/gate44/help-center/{page,
 * docs/new,docs/[id]}.tsx: category CRUD, doc list, and a doc editor overlay
 * (create + edit collapsed into one modal — the native-mobile equivalent of
 * web's separate /docs/new and /docs/[id] pages).
 *
 * GET/POST     /admin/help-center/categories
 * PUT/DELETE   /admin/help-center/categories/:id
 * GET/POST     /admin/help-center/docs
 * PUT/DELETE   /admin/help-center/docs/:id
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminCardSkeleton,
  AdminEmptyState,
  AdminToast,
  AdminBadge,
  adminInputClass,
} from '@/components/admin/AdminUI';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  published: boolean;
  sort_order: number;
}

interface Doc {
  id: string;
  title: string;
  slug: string;
  category_id: string;
  category_slug: string;
  category_name: string;
  body_markdown?: string;
  difficulty: string;
  published: boolean;
}

const DIFFICULTIES = ['first_time', 'beginner', 'intermediate', 'advanced'] as const;

async function fetchCategories(): Promise<Category[]> {
  const { data } = await apiClient.get<Category[]>('/admin/help-center/categories');
  return data ?? [];
}

async function fetchDocs(): Promise<Doc[]> {
  const { data } = await apiClient.get<Doc[]>('/admin/help-center/docs');
  return data ?? [];
}

type DocDraft = { id?: string; categoryId: string; title: string; bodyMarkdown: string; difficulty: string; published: boolean };

function DocEditorOverlay({
  draft,
  categories,
  onClose,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  draft: DocDraft;
  categories: Category[];
  onClose: () => void;
  onSave: (d: DocDraft) => void;
  onDelete?: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState(draft);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-800">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{d.id ? t('admin.helpCenter.editDoc', 'Edit Doc') : t('admin.helpCenter.newDoc', 'New Doc')}</h2>
        <button onClick={onClose} aria-label={t('nav.closeMenu')} className="rounded-lg p-1.5 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <select value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })} className={adminInputClass}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder={t('admin.helpCenter.title', 'Title')} className={adminInputClass} />
        <select value={d.difficulty} onChange={(e) => setD({ ...d, difficulty: e.target.value })} className={adminInputClass}>
          {DIFFICULTIES.map((diff) => <option key={diff} value={diff}>{diff}</option>)}
        </select>
        <textarea
          value={d.bodyMarkdown}
          onChange={(e) => setD({ ...d, bodyMarkdown: e.target.value })}
          placeholder={t('admin.helpCenter.bodyPlaceholder', 'Markdown body…')}
          rows={12}
          className={`${adminInputClass} resize-none font-mono text-xs`}
        />
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={d.published} onChange={(e) => setD({ ...d, published: e.target.checked })} />
          {t('admin.helpCenter.published', 'Published')}
        </label>

        <button
          type="button"
          disabled={saving || !d.title.trim() || !d.bodyMarkdown.trim() || !d.categoryId}
          onClick={() => onSave(d)}
          className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? '…' : d.id ? t('admin.helpCenter.saveDoc', 'Save Doc') : t('admin.helpCenter.createDoc', 'Create Doc')}
        </button>
        {onDelete && (
          <button
            type="button"
            disabled={deleting}
            onClick={onDelete}
            className="w-full rounded-lg bg-danger-100 dark:bg-danger-900/40 py-2.5 text-sm font-semibold text-danger-700 dark:text-danger-300 disabled:opacity-50"
          >
            {deleting ? '…' : t('admin.helpCenter.deleteDoc', 'Delete Doc')}
          </button>
        )}
      </div>
    </div>
  );
}

function AdminHelpCenterPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [editingDraft, setEditingDraft] = useState<DocDraft | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: categories, status: catStatus } = useQuery({ queryKey: ['admin', 'help-center', 'categories'], queryFn: fetchCategories });
  const { data: docs, status: docStatus } = useQuery({ queryKey: ['admin', 'help-center', 'docs'], queryFn: fetchDocs });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'help-center', 'categories'] });
    qc.invalidateQueries({ queryKey: ['admin', 'help-center', 'docs'] });
  };

  const createCategory = useMutation({
    mutationFn: () => apiClient.post('/admin/help-center/categories', { name: newCatName.trim() }),
    onSuccess: () => { setNewCatName(''); notify(t('admin.helpCenter.categoryCreated', 'Category created')); invalidateAll(); },
    onError: () => notify(t('admin.helpCenter.categoryCreateFailed', 'Failed to create category'), 'error'),
  });

  const toggleCategoryPublished = useMutation({
    mutationFn: (c: Category) => apiClient.put(`/admin/help-center/categories/${c.id}`, { published: !c.published }),
    onSuccess: () => invalidateAll(),
    onError: () => notify(t('admin.saveFailed', 'Update failed'), 'error'),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/help-center/categories/${id}`),
    onSuccess: () => { notify(t('admin.helpCenter.categoryDeleted', 'Category deleted')); invalidateAll(); },
    onError: () => notify(t('admin.helpCenter.categoryDeleteFailed', 'Failed to delete (it may still have docs)'), 'error'),
  });

  const saveDoc = useMutation({
    mutationFn: (d: DocDraft) =>
      d.id
        ? apiClient.put(`/admin/help-center/docs/${d.id}`, { categoryId: d.categoryId, title: d.title, bodyMarkdown: d.bodyMarkdown, difficulty: d.difficulty, published: d.published })
        : apiClient.post('/admin/help-center/docs', { categoryId: d.categoryId, title: d.title, bodyMarkdown: d.bodyMarkdown, difficulty: d.difficulty, published: d.published }),
    onSuccess: () => {
      notify(t('admin.saved', 'Saved'));
      setCreatingDoc(false);
      setEditingDocId(null);
      setEditingDraft(null);
      invalidateAll();
    },
    onError: () => notify(t('admin.saveFailed', 'Failed to save'), 'error'),
  });

  const deleteDoc = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/help-center/docs/${id}`),
    onSuccess: () => {
      notify(t('admin.helpCenter.docDeleted', 'Doc deleted'));
      setEditingDocId(null);
      setEditingDraft(null);
      invalidateAll();
    },
    onError: () => notify(t('admin.saveFailed', 'Failed to delete'), 'error'),
  });

  const openDocEditor = (doc: Doc) => {
    setEditingDocId(doc.id);
    setEditingDraft({ id: doc.id, categoryId: doc.category_id, title: doc.title, bodyMarkdown: doc.body_markdown ?? '', difficulty: doc.difficulty, published: doc.published });
  };

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.nav.helpCenter', 'Help Center')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <section className="mb-6">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('admin.helpCenter.categories', 'Categories')}</h2>
        <div className="mb-3 flex gap-2">
          <input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder={t('admin.helpCenter.newCategoryPlaceholder', 'New category name')}
            className={adminInputClass}
          />
          <button
            type="button"
            onClick={() => createCategory.mutate()}
            disabled={!newCatName.trim() || createCategory.isPending}
            className="shrink-0 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t('admin.helpCenter.add', 'Add')}
          </button>
        </div>
        <div className="space-y-2">
          {catStatus === 'pending' && Array.from({ length: 2 }).map((_, i) => <AdminCardSkeleton key={i} />)}
          {catStatus === 'success' &&
            categories?.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3.5 shadow-card">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{c.name} <span className="text-xs text-neutral-500 dark:text-neutral-400">/{c.slug}</span></p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleCategoryPublished.mutate(c)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${c.published ? 'bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'}`}
                  >
                    {c.published ? t('admin.helpCenter.published', 'Published') : t('admin.helpCenter.draft', 'Draft')}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCategory.mutate(c.id)}
                    disabled={deleteCategory.isPending}
                    className="rounded-lg bg-danger-100 dark:bg-danger-900/40 px-2.5 py-1 text-xs font-semibold text-danger-700 dark:text-danger-300 disabled:opacity-50"
                  >
                    {t('admin.helpCenter.deleteCategory', 'Delete')}
                  </button>
                </div>
              </div>
            ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('admin.helpCenter.docs', 'Docs')}</h2>
          <button
            type="button"
            onClick={() => {
              setCreatingDoc(true);
              setEditingDraft({ categoryId: categories?.[0]?.id ?? '', title: '', bodyMarkdown: '', difficulty: 'first_time', published: false });
            }}
            disabled={!categories?.length}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {t('admin.helpCenter.newDoc', 'New Doc')}
          </button>
        </div>
        <div className="space-y-2">
          {docStatus === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
          {docStatus === 'success' && (docs?.length ?? 0) === 0 && <AdminEmptyState icon="📚" title={t('admin.helpCenter.noDocs', 'No docs yet')} />}
          {docStatus === 'success' &&
            docs?.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => openDocEditor(doc)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3.5 text-left shadow-card active:bg-neutral-50 dark:active:bg-neutral-800"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{doc.title}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{doc.category_name} · {doc.difficulty}</p>
                </div>
                <AdminBadge label={doc.published ? t('admin.helpCenter.published', 'Published') : t('admin.helpCenter.draft', 'Draft')} color={doc.published ? 'green' : 'neutral'} />
              </button>
            ))}
        </div>
      </section>

      {(creatingDoc || editingDocId) && editingDraft && (
        <DocEditorOverlay
          draft={editingDraft}
          categories={categories ?? []}
          onClose={() => { setCreatingDoc(false); setEditingDocId(null); setEditingDraft(null); }}
          onSave={(d) => saveDoc.mutate(d)}
          onDelete={editingDocId ? () => deleteDoc.mutate(editingDocId) : undefined}
          saving={saveDoc.isPending}
          deleting={deleteDoc.isPending}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/help-center')({
  component: AdminHelpCenterPage,
});
