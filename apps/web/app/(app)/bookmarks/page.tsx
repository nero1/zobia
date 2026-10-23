"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from '@/components/ui/Link';
type Folder = { id: string; name: string };
type Item = { id: string; title: string; url: string; folderId: string | null };
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || 'Request failed.'); return result.data;
}
export default function BookmarksPage() {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<Folder[]>([]); const [folder, setFolder] = useState('');
  const [items, setItems] = useState<Item[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [name, setName] = useState(''); const [quota, setQuota] = useState({ limit: 0, nextCost: 100 });
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null); const generation = useRef(0);
  const loadFolders = useCallback(async () => {
    const result = await request<{ folders: Folder[]; limit: number; nextCost: number }>('/bookmarks/folders'); setFolders(result.folders); setQuota(result);
  }, []);
  const load = useCallback(async (next?: string) => {
    const version = ++generation.current;
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams(); if (folder) query.set('folderId', folder); if (next) query.set('cursor', next);
      const result = await request<{ items: Item[]; nextCursor: string | null }>(`/bookmarks?${query}`);
      if (version !== generation.current) return;
      setItems((previous) => next ? [...previous, ...result.items] : result.items); setCursor(result.nextCursor);
    } catch (err) { if (version === generation.current) setError(err instanceof Error ? err.message : t('error.generic')); }
    finally { if (version === generation.current) setBusy(false); }
  }, [folder, t]);
  useEffect(() => { void loadFolders().catch((err) => setError(String(err))); }, [loadFolders]);
  useEffect(() => { void load(); }, [load]);
  async function mutate(path: string, method: string, data: unknown) {
    setBusy(true); setError(null);
    try { await request(path, method, data); await loadFolders(); await load(); return true; }
    catch (err) { setError(err instanceof Error ? err.message : t('error.generic')); return false; }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-3xl space-y-4 p-4">
    <h1 className="text-2xl font-bold">{t('bookmarks.title', 'Bookmarks')}</h1>
    <p className="text-sm text-neutral-500">{t('bookmarks.permanent', 'Your unlocked folder slots stay with your account after a plan downgrade. Deleting a folder keeps its bookmarks in All bookmarks.')}</p>
    <div className="flex flex-wrap gap-2">
      <input aria-label={t('bookmarks.folderName', 'Folder name')} value={name} maxLength={80} onChange={(e) => { setName(e.target.value); requestId.current = null; }} className="rounded-lg border border-border bg-background p-2 text-sm" />
      <button disabled={busy || !name.trim()} className="rounded-full border px-4 py-2 text-sm disabled:opacity-50" onClick={async () => {
        if (quota.nextCost > 0 && !window.confirm(t('bookmarks.confirmCost', 'Deduct {{cost}} credits to unlock one more folder slot?', { cost: quota.nextCost }))) return;
        requestId.current ??= crypto.randomUUID();
        if (await mutate('/bookmarks/folders', 'POST', { id: requestId.current, name: name.trim(), confirmedCost: quota.nextCost })) { setName(''); requestId.current = null; }
      }}>{t('bookmarks.createFolder', 'Create folder')} {quota.nextCost > 0 ? `· ${quota.nextCost}` : ''}</button>
      <span className="self-center text-xs">{folders.length}/{quota.limit} {t('bookmarks.folders', 'folders')}</span>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={t('bookmarks.folders', 'Folders')} value={folder} onChange={(e) => setFolder(e.target.value)} className="rounded-lg border border-border bg-background p-2 text-sm"><option value="">{t('bookmarks.all', 'All bookmarks')}</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      {folder && <><button className="text-sm underline" onClick={() => { const next = window.prompt(t('bookmarks.folderName', 'Folder name'), folders.find((f) => f.id === folder)?.name); if (next?.trim()) void mutate('/bookmarks/folders', 'PATCH', { id: folder, name: next.trim() }); }}>{t('bookmarks.rename', 'Rename')}</button><button className="text-sm text-red-500" onClick={async () => { if (window.confirm(t('bookmarks.deleteFolder', 'Delete this folder? Your bookmarks will be kept.')) && await mutate('/bookmarks/folders', 'DELETE', { id: folder })) setFolder(''); }}>{t('action.delete', 'Delete')}</button></>}
    </div>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {!items.length && !busy && <p className="text-sm text-neutral-500">{t('bookmarks.empty', 'No bookmarks here yet. Save content from your feed to find it here.')}</p>}
    {items.map((item) => <article key={item.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <Link href={item.url} className="font-semibold hover:underline">{item.title}</Link>
      <div className="flex gap-3"><select disabled={busy} aria-label={t('bookmarks.move', 'Move to folder')} value={item.folderId || ''} onChange={(e) => void mutate('/bookmarks', 'PATCH', { id: item.id, folderId: e.target.value || null })} className="min-w-0 rounded-lg border border-border bg-background p-2 text-xs"><option value="">{t('bookmarks.unfiled', 'Unfiled')}</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><button disabled={busy} className="text-xs text-red-500" onClick={() => void mutate('/bookmarks', 'DELETE', { id: item.id })}>{t('bookmarks.remove', 'Remove bookmark')}</button></div>
    </article>)}
    {cursor && <button disabled={busy} onClick={() => void load(cursor)} className="rounded-full border px-4 py-2 text-sm">{t('common.loadMore', 'Load more')}</button>}
  </div>;
}
