"use client";

/**
 * app/(admin)/gate44/help-center/page.tsx
 *
 * Help Center admin — category CRUD + doc list, mirroring the queue/detail
 * shape used elsewhere (list here, editor at /gate44/help-center/docs/[id]).
 * Admin-only.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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
  category_slug: string;
  category_name: string;
  difficulty: string;
  published: boolean;
}

export default function AdminHelpCenterPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/admin/help-center/categories", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/admin/help-center/docs", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([catJson, docJson]) => {
        setCategories(catJson?.data ?? []);
        setDocs(docJson?.data ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createCategory() {
    if (!newCatName.trim()) return;
    await fetch("/api/admin/help-center/categories", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCatName.trim() }),
    });
    setNewCatName("");
    load();
  }

  async function toggleCategoryPublished(cat: Category) {
    await fetch(`/api/admin/help-center/categories/${cat.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !cat.published }),
    });
    load();
  }

  async function deleteCategoryAction(id: string) {
    if (!confirm("Delete this category and all its docs?")) return;
    await fetch(`/api/admin/help-center/categories/${id}`, { method: "DELETE", credentials: "include" });
    load();
  }

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Help Center</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase text-neutral-500">Categories</h2>
        <div className="mb-3 flex gap-2">
          <input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="New category name"
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
          <button onClick={createCategory} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">Add</button>
        </div>
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{cat.name} <span className="text-xs text-neutral-500">/{cat.slug}</span></p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleCategoryPublished(cat)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cat.published ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}>
                  {cat.published ? "Published" : "Draft"}
                </button>
                <button onClick={() => deleteCategoryAction(cat.id)} className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 dark:bg-red-900 dark:text-red-300">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-neutral-500">Docs</h2>
          <Link href="/gate44/help-center/docs/new" className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white">New Doc</Link>
        </div>
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {docs.map((doc) => (
            <Link key={doc.id} href={`/gate44/help-center/docs/${doc.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
              <div>
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{doc.title}</p>
                <p className="text-xs text-neutral-500">{doc.category_name} · {doc.difficulty}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${doc.published ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}>
                {doc.published ? "Published" : "Draft"}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
