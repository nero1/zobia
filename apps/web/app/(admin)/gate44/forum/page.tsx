"use client";

/**
 * app/(admin)/gate44/forum/page.tsx
 *
 * Boards manager for the old-school BB-style forum — create/rename/reorder/
 * activate/deactivate boards and sub-boards. Mirrors the Categories manager
 * on app/(admin)/gate44/answers/settings/page.tsx.
 */

import { useState, useEffect, useCallback } from "react";

interface BoardRow {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  icon_emoji: string;
  sort_order: number;
  thread_count: number;
  post_count: number;
  is_active: boolean;
}

export default function ForumBoardsPage() {
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💬");
  const [parentId, setParentId] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/bbforum/boards", { credentials: "include" });
    const json = await res.json().catch(() => null);
    if (json?.success) setBoards(json.data.boards);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const res = await fetch("/api/admin/bbforum/boards", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), iconEmoji: icon || "💬", parentId: parentId || null }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to create board");
      setName(""); setIcon("💬"); setParentId("");
      showToast("Board created");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to create board", "error");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/bbforum/boards/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Update failed");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Update failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this board? Its threads and posts will be deleted too. This can't be undone.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/bbforum/boards/${id}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Delete failed");
      showToast("Board deleted");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  const topLevel = boards.filter((b) => !b.parent_id);

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Forum Boards</h1>
      <p className="mb-6 text-sm text-neutral-500">Manage the old-school BB-style forum&apos;s boards and sub-boards (home: /forum, threads: /f/&lt;slug&gt;).</p>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-14 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-center text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50" placeholder="💬" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New board name" className="min-w-[10rem] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50" />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
          <option value="">Top-level board</option>
          {topLevel.map((b) => <option key={b.id} value={b.id}>Sub-board of {b.name}</option>)}
        </select>
        <button onClick={handleCreate} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700">Add</button>
      </div>

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
      ) : (
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {boards.map((b) => (
            <div key={b.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${b.parent_id ? "pl-10" : ""} ${!b.is_active ? "opacity-50" : ""}`}>
              <span>{b.icon_emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">{b.name}</p>
                <p className="text-xs text-neutral-400">/{b.slug} · {b.thread_count} threads · {b.post_count} posts</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  disabled={busyId === b.id}
                  onClick={() => { const next = window.prompt("Rename board:", b.name); if (next && next.trim() !== b.name) patch(b.id, { name: next.trim() }); }}
                  className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900 dark:text-blue-300"
                >Rename</button>
                <button disabled={busyId === b.id} onClick={() => patch(b.id, { isActive: !b.is_active })} className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">
                  {b.is_active ? "Deactivate" : "Activate"}
                </button>
                <button disabled={busyId === b.id} onClick={() => handleDelete(b.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-950 dark:text-red-300">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
