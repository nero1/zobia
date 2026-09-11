"use client";

/**
 * app/(admin)/admin/polls/page.tsx
 *
 * Admin monitoring for all polls: filter by status, toggle status
 * (active/closed/disabled), and delete. Mirrors the table pattern from
 * admin/blogs/page.tsx, with cursor pagination mirrored from admin/gifts/page.tsx.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { formatShortDate } from "@/lib/format/date";

interface PollRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  voter_count: number;
  share_count: number;
  created_at: string;
  creator_id: string;
  creator_username: string;
}

type StatusFilter = "all" | "active" | "closed" | "disabled";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300",
  closed: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  disabled: "bg-danger-100 text-danger-700 dark:bg-danger-900 dark:text-danger-300",
};

export default function AdminPollsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState<PollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, kind: "success" | "error" = "success") => {
    setToast({ msg, type: kind });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPolls = useCallback(async (s: StatusFilter, q: string, reset = true, cur: string | null = null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: s, limit: "50" });
      if (q) params.set("q", q);
      if (!reset && cur) params.set("cursor", cur);
      const res = await fetch(`/api/admin/polls?${params.toString()}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/gate44/login"; return; }
      const data = await res.json();
      const items: PollRow[] = data?.data?.items ?? [];
      setRows((prev) => (reset ? items : [...prev, ...items]));
      setCursor(data?.data?.nextCursor ?? null);
      setHasMore(!!data?.data?.hasMore);
    } catch {
      showToast("Failed to load polls", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void fetchPolls(status, debouncedSearch, true); }, [status, debouncedSearch, fetchPolls]);

  async function handleStatus(id: string, next: "active" | "closed" | "disabled") {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/polls/${id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Action failed");
      showToast("Status updated");
      await fetchPolls(status, debouncedSearch, true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Permanently delete this poll? This cannot be undone.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/polls/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      showToast("Poll deleted");
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Polls</h1>
        <Link href="/gate44/polls/settings" className="text-sm font-semibold text-teal-600 hover:underline dark:text-teal-400">Settings →</Link>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search by title, slug, creator username, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50 w-fit">
        {(["all", "active", "closed", "disabled"] as StatusFilter[]).map((s) => (
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
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Voters</th>
              <th className="px-4 py-3">Shares</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading && rows.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>)}</tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-500">No polls.</td></tr>
            ) : rows.map((p) => (
              <tr key={p.id}>
                <td className="max-w-xs truncate px-4 py-3 font-medium text-neutral-900 dark:text-neutral-50">
                  <Link href={`/poll/${p.slug}`} target="_blank" className="hover:underline">{p.title}</Link>
                </td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">@{p.creator_username}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[p.status] ?? ""}`}>{p.status}</span>
                </td>
                <td className="px-4 py-3 tabular-nums">{p.voter_count}</td>
                <td className="px-4 py-3 tabular-nums">{p.share_count}</td>
                <td className="px-4 py-3 text-neutral-500">{formatShortDate(p.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {p.status !== "active" && (
                      <button disabled={busy === p.id} onClick={() => handleStatus(p.id, "active")} className="rounded-lg bg-teal-100 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300">Activate</button>
                    )}
                    {p.status !== "closed" && (
                      <button disabled={busy === p.id} onClick={() => handleStatus(p.id, "closed")} className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">Close</button>
                    )}
                    {p.status !== "disabled" && (
                      <button disabled={busy === p.id} onClick={() => handleStatus(p.id, "disabled")} className="rounded-lg bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50 dark:bg-orange-900 dark:text-orange-300">Disable</button>
                    )}
                    <button disabled={busy === p.id} onClick={() => handleDelete(p.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          onClick={() => void fetchPolls(status, debouncedSearch, false, cursor)}
          disabled={loading}
          className="mt-3 w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
