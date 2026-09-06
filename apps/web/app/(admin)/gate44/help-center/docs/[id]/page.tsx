"use client";

/**
 * app/(admin)/gate44/help-center/docs/[id]/page.tsx
 *
 * Edit a Help Center doc. PUT /api/admin/help-center/docs/[id].
 */

import { useState, useEffect, use } from "react";

interface Category {
  id: string;
  name: string;
}

interface Doc {
  id: string;
  category_id: string;
  title: string;
  slug: string;
  body_markdown: string;
  difficulty: string;
  published: boolean;
}

const DIFFICULTIES = ["first_time", "beginner", "intermediate", "advanced"] as const;

export default function EditHelpDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [categories, setCategories] = useState<Category[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    fetch("/api/admin/help-center/categories", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((json) => setCategories(json?.data ?? []));
    fetch("/api/admin/help-center/docs", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setDoc((json?.data ?? []).find((d: Doc) => d.id === id) ?? null));
  }, [id]);

  async function save() {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/help-center/docs/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: doc.category_id,
          slug: doc.slug,
          title: doc.title,
          bodyMarkdown: doc.body_markdown,
          difficulty: doc.difficulty,
          published: doc.published,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error?.message ?? "Failed to save");
      setToast(true);
      setTimeout(() => setToast(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!doc) return <div className="h-64 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">Edit Doc</h1>
      <p className="mb-4 text-xs text-neutral-500">
        Slug: <input value={doc.slug} onChange={(e) => setDoc({ ...doc, slug: e.target.value })} className="w-56 rounded border border-neutral-300 bg-white px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-800" />
        {" "}— changing this records a redirect from the old slug automatically.
      </p>
      <div className="space-y-3">
        <select value={doc.category_id} onChange={(e) => setDoc({ ...doc, category_id: e.target.value })} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
        <select value={doc.difficulty} onChange={(e) => setDoc({ ...doc, difficulty: e.target.value })} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <textarea value={doc.body_markdown} onChange={(e) => setDoc({ ...doc, body_markdown: e.target.value })} rows={16} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-800" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={doc.published} onChange={(e) => setDoc({ ...doc, published: e.target.checked })} />
          Published
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button onClick={save} disabled={saving} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {toast && <span className="ml-3 text-sm text-teal-600">Saved</span>}
      </div>
    </div>
  );
}
