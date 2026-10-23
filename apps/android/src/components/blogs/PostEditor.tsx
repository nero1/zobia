import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { isAxiosError } from 'axios';

type Form = {
  type: 'article' | 'page'; title: string; excerpt: string; bodyMarkdown: string;
  contentFormat: 'markdown' | 'plaintext'; featuredImageUrl: string; isPaywalled: boolean;
  paywallCreditsCost: number; status: 'draft' | 'published';
};
const empty: Form = { type: 'article', title: '', excerpt: '', bodyMarkdown: '', contentFormat: 'markdown', featuredImageUrl: '', isPaywalled: false, paywallCreditsCost: 5, status: 'draft' };

/** Uses the same private-revision endpoint and scoped recovery storage as web. */
export function PostEditor({ blogSlug, postSlug: initialSlug, type = 'article', onClose, onSaved }: { blogSlug: string; postSlug?: string; type?: 'article' | 'page'; onClose: () => void; onSaved: (publishedSlug?: string) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [postSlug, setPostSlug] = useState(initialSlug);
  const [form, setForm] = useState<Form>({ ...empty, type });
  const baseline = useRef(form);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = user?.id ? `blog-draft:${user.id}:${blogSlug}:${initialSlug || `new-${type}`}` : null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let original = { ...empty, type };
      if (initialSlug) {
        const { data } = await apiClient.get<{ post: Record<string, unknown>; draft?: Partial<Form>; canEdit?: boolean }>(`/blogs/${blogSlug}/posts/${initialSlug}`);
        if (!data.canEdit) throw new Error(t('error.forbidden', 'You cannot edit this post.'));
        const p = data.post;
        original = { type: p.type as Form['type'], title: String(p.title), excerpt: String(p.excerpt || ''), bodyMarkdown: String(p.body_markdown || ''), contentFormat: p.content_format === 'plaintext' ? 'plaintext' : 'markdown', featuredImageUrl: String(p.featured_image_url || ''), isPaywalled: Boolean(p.is_paywalled), paywallCreditsCost: Number(p.paywall_credits_cost), status: p.status as Form['status'], ...data.draft };
      }
      if (cancelled) return;
      baseline.current = original;
      try { const cached = key && localStorage.getItem(key); setForm(cached ? { ...original, ...JSON.parse(cached) } : original); }
      catch { setForm(original); }
      setReady(true);
    })().catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t('error.generic')); });
    return () => { cancelled = true; };
  }, [blogSlug, initialSlug, key, type, t]);
  useEffect(() => {
    if (!key || !ready) return;
    try { localStorage.setItem(key, JSON.stringify(form)); } catch { /* storage unavailable */ }
  }, [key, ready, form]);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline.current);
  async function save(status: Form['status'], saveRevision = false) {
    setBusy(true); setError(null);
    try {
      const payload = { ...form, featuredImageUrl: form.featuredImageUrl || null, status, saveRevision };
      let savedSlug = postSlug;
      let firstPublished = false;
      if (postSlug) { const {data}=await apiClient.patch<{firstPublished:boolean}>(`/blogs/${blogSlug}/posts/${postSlug}`, payload); firstPublished=!!data.firstPublished; }
      else {
        const { data } = await apiClient.post<{ slug: string }>(`/blogs/${blogSlug}/posts`, { ...payload, featuredImageUrl: form.featuredImageUrl || undefined });
        savedSlug = data.slug; setPostSlug(savedSlug); firstPublished = status === "published";
      }
      baseline.current = { ...form, status: saveRevision ? form.status : status }; setForm(baseline.current);
      if (key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }
      setNotice(saveRevision ? t('blogEditing.savedPrivate') : status === 'published' ? t('blogs.status.published', 'Published') : t('blogEditing.unpublished'));
      onSaved(firstPublished ? savedSlug : undefined);
      if(firstPublished) onClose();
    } catch (err) { setError(isAxiosError(err) ? err.response?.data?.error?.message ?? err.message : err instanceof Error ? err.message : t('error.generic')); }
    finally { setBusy(false); }
  }
  const fieldClass = 'w-full rounded-lg border border-neutral-300 bg-white p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  return <div className="space-y-3 p-4">
    <button onClick={onClose} className="text-sm underline">{t('action.back', 'Back')}</button>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {!ready ? <p>{t('common.loading', 'Loading…')}</p> : <>
      <label className="block text-sm">{t('blogs.editor.titleLabel', 'Title')}<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={fieldClass} /></label>
      <label className="block text-sm">{t('blogs.editor.excerptLabel', 'Excerpt')}<textarea value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} className={fieldClass} /></label>
      <label className="block text-sm">{t('blogs.editor.featuredImage', 'Featured image URL')}<input type="url" value={form.featuredImageUrl} onChange={(e) => setForm({ ...form, featuredImageUrl: e.target.value })} className={fieldClass} /></label>
      <label className="block text-sm">{t('blogs.editor.bodyLabel', 'Content')}<textarea rows={18} value={form.bodyMarkdown} onChange={(e) => setForm({ ...form, bodyMarkdown: e.target.value })} className={fieldClass} /></label>
      <label className="block text-sm">{t('blogs.editor.contentFormat', 'Format')}<select value={form.contentFormat} onChange={(e) => setForm({ ...form, contentFormat: e.target.value as Form['contentFormat'] })} className={fieldClass}><option value="markdown">Markdown</option><option value="plaintext">{t('blogs.editor.plainText', 'Plain text')}</option></select></label>
      {form.type === 'article' && <><label className="flex gap-2 text-sm"><input type="checkbox" checked={form.isPaywalled} onChange={(e) => setForm({ ...form, isPaywalled: e.target.checked })} />{t('blogs.editor.paywallToggle', 'Pay-gate this article')}</label>{form.isPaywalled && <label className="block text-sm">{t('blogs.editor.paywallCostLabel', 'Cost to unlock:')}<input type="number" min={1} max={100000} value={form.paywallCreditsCost} onChange={(e) => setForm({ ...form, paywallCreditsCost: Math.max(0, Number(e.target.value)) })} className={fieldClass} /></label>}</>}
      {notice && <p role="status" className="rounded-lg bg-green-500/10 p-3 text-sm text-green-600">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        {dirty && <button onClick={() => setForm(baseline.current)} className="rounded-full border px-4 py-2 text-sm">{t('blogEditing.discard')}</button>}
        {form.status === 'published' && <button disabled={busy || !dirty} onClick={() => void save('published', true)} className="rounded-full border px-4 py-2 text-sm disabled:opacity-50">{t('common.save', 'Save')}</button>}
        <button disabled={busy || !form.title.trim() || !form.bodyMarkdown.trim()} onClick={() => void save('draft')} className="rounded-full border px-4 py-2 text-sm disabled:opacity-50">{form.status === 'published' ? t('blogEditing.unpublish') : t('blogs.editor.saveDraft', 'Save draft')}</button>
        <button disabled={busy || !form.title.trim() || !form.bodyMarkdown.trim()} onClick={() => void save('published')} className="rounded-full bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50">{t('blogs.editor.publish', 'Publish')}</button>
      </div>
    </>}
  </div>;
}
