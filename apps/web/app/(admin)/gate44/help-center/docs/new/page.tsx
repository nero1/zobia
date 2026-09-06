"use client";

/**
 * app/(admin)/admin/help-center/docs/new/page.tsx
 *
 * Create a Help Center doc. POST /api/admin/help-center/docs.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Category {
  id: string;
  name: string;
}

const DIFFICULTIES = ["first_time", "beginner", "intermediate", "advanced"] as const;

export default function NewHelpDocPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("first_time");
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/help-center/categories", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const cats: Category[] = json?.data ?? [];
        setCategories(cats);
        if (cats[0]) setCategoryId(cats[0].id);
      });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/help-center/docs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, title, bodyMarkdown: body, difficulty, published }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to save");
      router.push(`/admin/help-center/docs/${json.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">New Help Doc</h1>
      <div className="space-y-3">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown body…" rows={14} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-800" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button onClick={save} disabled={saving || !title.trim() || !body.trim() || !categoryId} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Create Doc"}
        </button>
      </div>
    </div>
  );
}
