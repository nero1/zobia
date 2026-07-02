"use client";

/**
 * app/(app)/business/pages/page.tsx
 *
 * Business Pages management (PRD §17). Lists the owner's pages with slot
 * usage against their tier's limit, lets them create a new page (blocked
 * once the limit is reached) and delete a page to free a slot.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface BusinessPage {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  status: string;
  view_count: number;
  post_count: number;
  created_at: string;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    deactivated: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    suspended: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    banned: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return map[status] ?? map.active;
}

export default function BusinessPagesListPage() {
  const [pages, setPages] = useState<BusinessPage[]>([]);
  const [limit, setLimit] = useState(2);
  const [used, setUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BusinessPage | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/business/pages", { credentials: "include" });
      if (res.status === 404) {
        setError("You need a business account first.");
        return;
      }
      const json = await res.json();
      if (json.success) {
        setPages(json.data.pages);
        setLimit(json.data.limit);
        setUsed(json.data.used);
      } else {
        setError(json.error?.message ?? "Failed to load pages");
      }
    } catch {
      setError("Failed to load pages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/business/pages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), bio: bio.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to create page");
      setName("");
      setBio("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create page");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/business/pages/${deleteTarget.id}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to delete page");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete page");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-40 animate-pulse rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      </div>
    );
  }

  const atLimit = used >= limit;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/business" className="text-sm text-neutral-500 hover:underline">← Business</Link>
        <span className="text-neutral-300">/</span>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Business Pages</h1>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{used}</span> of{" "}
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{limit}</span> page slots used
        </p>
        <button
          onClick={() => setShowForm((s) => !s)}
          disabled={atLimit}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          title={atLimit ? "Delete a page or upgrade your tier to create another." : undefined}
        >
          + New Page
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Page Name</label>
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cadbury Nigeria"
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">Bio (optional)</label>
            <textarea
              maxLength={500}
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create Page"}
          </button>
        </form>
      )}

      {pages.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-12 text-center text-sm text-neutral-400 dark:border-neutral-700">
          No Business Pages yet. Create one to start attributing adverts and posts to your brand.
        </div>
      ) : (
        <div className="space-y-3">
          {pages.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex min-w-0 items-center gap-3">
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar_url} alt="" className="h-10 w-10 flex-shrink-0 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-lg dark:bg-neutral-800">🏢</div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{p.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusBadge(p.status)}`}>{p.status}</span>
                  </div>
                  <p className="truncate text-xs text-neutral-400">/p/{p.slug} · 👁 {p.view_count} · 📝 {p.post_count}</p>
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <Link
                  href={`/business/pages/${p.id}`}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Manage
                </Link>
                <button
                  onClick={() => setDeleteTarget(p)}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-2 font-semibold text-neutral-900 dark:text-white">Delete &quot;{deleteTarget.name}&quot;?</h3>
            <p className="mb-4 text-sm text-neutral-500">This frees a page slot. This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
