"use client";

/**
 * app/(admin)/admin/blogs/page.tsx
 *
 * Admin monitoring for all blogs: filter by status, suspend/ban/deactivate/
 * pause/restore/delete, and transfer ownership to another user. Mirrors the
 * table pattern from admin/forum/posts/page.tsx.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface BlogRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  status_reason: string | null;
  subscriber_count: number;
  post_count: number;
  created_at: string;
  owner_id: string;
  owner_username: string;
}

type StatusFilter = "all" | "active" | "paused" | "suspended" | "banned" | "deactivated";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300",
  paused: "bg-gold-100 text-gold-700 dark:bg-gold-900 dark:text-gold-300",
  suspended: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  banned: "bg-danger-100 text-danger-700 dark:bg-danger-900 dark:text-danger-300",
  deactivated: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export default function AdminBlogsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [rows, setRows] = useState<BlogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, kind: "success" | "error" = "success") => {
    setToast({ msg, type: kind });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchBlogs = useCallback(async (s: StatusFilter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/blogs?status=${s}&limit=50`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
      const data = await res.json();
      setRows(data?.data?.items ?? []);
    } catch {
      showToast("Failed to load blogs", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void fetchBlogs(status); }, [status, fetchBlogs]);

  async function handleAction(id: string, action: "suspend" | "ban" | "deactivate" | "pause" | "restore" | "delete") {
    if (action === "delete" && !confirm("Permanently delete this blog? This cannot be undone.")) return;
    const reason = action === "suspend" || action === "ban" ? prompt("Reason (optional):") ?? undefined : undefined;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/blogs/${id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) throw new Error("Action failed");
      showToast("Action applied");
      await fetchBlogs(status);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleTransfer(id: string) {
    const username = prompt("Transfer to which username?");
    if (!username?.trim()) return;
    setBusy(id);
    try {
      const searchRes = await fetch(`/api/admin/users?q=${encodeURIComponent(username.trim())}&limit=5`, { credentials: "include" });
      const searchJson = await searchRes.json();
      const match = (searchJson?.users ?? []).find((u: { username: string }) => u.username.toLowerCase() === username.trim().toLowerCase());
      if (!match) throw new Error(`No user found with username "${username.trim()}"`);

      const res = await fetch(`/api/admin/blogs/${id}/transfer`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId: match.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Transfer failed");
      showToast(`Transferred to @${username.trim()}`);
      await fetchBlogs(status);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Transfer failed", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Blogs</h1>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50 w-fit">
        {(["all", "active", "paused", "suspended", "banned", "deactivated"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${status === s ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Posts</th>
              <th className="px-4 py-3">Subscribers</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>)}</tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-500">No blogs.</td></tr>
            ) : rows.map((b) => (
              <tr key={b.id}>
                <td className="max-w-xs truncate px-4 py-3 font-medium text-neutral-900 dark:text-neutral-50">
                  <Link href={`/b/${b.slug}`} target="_blank" className="hover:underline">{b.title}</Link>
                </td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">@{b.owner_username}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[b.status] ?? ""}`}>{b.status}</span>
                  {b.status_reason && <div className="mt-0.5 text-[10px] text-neutral-500 max-w-[140px] truncate">{b.status_reason}</div>}
                </td>
                <td className="px-4 py-3 tabular-nums">{b.post_count}</td>
                <td className="px-4 py-3 tabular-nums">{b.subscriber_count}</td>
                <td className="px-4 py-3 text-neutral-500">{new Date(b.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {b.status !== "active" && (
                      <button disabled={busy === b.id} onClick={() => handleAction(b.id, "restore")} className="rounded-lg bg-teal-100 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300">Restore</button>
                    )}
                    {b.status === "active" && (
                      <>
                        <button disabled={busy === b.id} onClick={() => handleAction(b.id, "pause")} className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">Pause</button>
                        <button disabled={busy === b.id} onClick={() => handleAction(b.id, "suspend")} className="rounded-lg bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50 dark:bg-orange-900 dark:text-orange-300">Suspend</button>
                        <button disabled={busy === b.id} onClick={() => handleAction(b.id, "ban")} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300">Ban</button>
                        <button disabled={busy === b.id} onClick={() => handleAction(b.id, "deactivate")} className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">Deactivate</button>
                      </>
                    )}
                    <button disabled={busy === b.id} onClick={() => handleTransfer(b.id)} className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900 dark:text-blue-300">Transfer</button>
                    <button disabled={busy === b.id} onClick={() => handleAction(b.id, "delete")} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
