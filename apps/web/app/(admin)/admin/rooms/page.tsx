"use client";

/**
 * app/(admin)/admin/rooms/page.tsx
 *
 * Admin room management page.
 * Search, filter by status, and perform per-room admin actions:
 *   suspend, unsuspend, ban, flag, unflag, activate/deactivate,
 *   disable/enable monetization, edit details, delete.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminRoom {
  id: string;
  name: string;
  type: string;
  creator_username: string | null;
  member_count: number;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  is_banned: boolean;
  flagged_at: string | null;
  flag_reason: string | null;
  monetization_disabled: boolean;
  created_at: string;
}

type StatusFilter = "all" | "active" | "inactive" | "suspended" | "banned" | "flagged";

interface EditForm {
  name: string;
  description: string;
  type: string;
  max_members: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "suspended", label: "Suspended" },
  { key: "banned", label: "Banned" },
  { key: "flagged", label: "Flagged" },
];

const ROOM_TYPES = ["free_open", "vip", "drop", "tipping", "classroom", "guild"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ room }: { room: AdminRoom }) {
  if (room.is_banned) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Banned</span>;
  if (room.is_suspended) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Suspended</span>;
  if (room.flagged_at) return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">Flagged</span>;
  if (room.is_active) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Active</span>;
  return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">Inactive</span>;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminRoomsPage() {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Modal states
  const [flagTarget, setFlagTarget] = useState<AdminRoom | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [suspendTarget, setSuspendTarget] = useState<AdminRoom | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [editTarget, setEditTarget] = useState<AdminRoom | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", description: "", type: "", max_members: "" });
  const [deleteTarget, setDeleteTarget] = useState<AdminRoom | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchRooms = useCallback(async (reset = true) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "20" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (!reset && cursor) params.set("cursor", cursor);

    try {
      const res = await fetch(`/api/admin/rooms?${params}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        setRooms(prev => reset ? json.data.rooms : [...prev, ...json.data.rooms]);
        setCursor(json.data.nextCursor ?? null);
        setHasMore(!!json.data.nextCursor);
      } else {
        showToast(json.error?.message ?? "Failed to load rooms", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, cursor, showToast]);

  useEffect(() => {
    void fetchRooms(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, debouncedSearch]);

  async function doAction(roomId: string, action: string, extra?: Record<string, unknown>) {
    setBusy(roomId);
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (json.success) {
        showToast("Action applied");
        await fetchRooms(true);
      } else {
        showToast(json.error?.message ?? "Action failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(roomId: string) {
    setBusy(roomId);
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (json.success) {
        showToast("Room deleted");
        setDeleteTarget(null);
        await fetchRooms(true);
      } else {
        showToast(json.error?.message ?? "Delete failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusy(null);
    }
  }

  async function submitFlag() {
    if (!flagTarget || !flagReason.trim()) return;
    await doAction(flagTarget.id, "flag", { reason: flagReason.trim() });
    setFlagTarget(null);
    setFlagReason("");
  }

  async function submitSuspend() {
    if (!suspendTarget || !suspendReason.trim()) return;
    await doAction(suspendTarget.id, "suspend", { reason: suspendReason.trim() });
    setSuspendTarget(null);
    setSuspendReason("");
  }

  async function submitEdit() {
    if (!editTarget) return;
    const payload: Record<string, unknown> = { action: "update_details" };
    if (editForm.name.trim()) payload.name = editForm.name.trim();
    if (editForm.description.trim()) payload.description = editForm.description.trim();
    if (editForm.type) payload.type = editForm.type;
    if (editForm.max_members) payload.max_members = parseInt(editForm.max_members, 10);
    await doAction(editTarget.id, "update_details", payload);
    setEditTarget(null);
  }

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Room Management</h1>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          placeholder="Search rooms by name or creator…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      {/* Status tabs */}
      <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {STATUS_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition-colors ${
              statusFilter === key
                ? "bg-white text-neutral-900 shadow dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Rooms list */}
      {loading && rooms.length === 0 ? (
        <div className="text-center py-12 text-neutral-500">Loading rooms…</div>
      ) : rooms.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-500">
          No rooms found.
        </div>
      ) : (
        <div className="space-y-3">
          {rooms.map((room) => (
            <div key={room.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-semibold text-neutral-900 dark:text-white truncate">{room.name}</span>
                    <StatusBadge room={room} />
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{room.type}</span>
                    {room.monetization_disabled && (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-900 dark:text-purple-300">💳 Monetization off</span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500">
                    @{room.creator_username ?? "unknown"} · {room.member_count} members · Created {formatDate(room.created_at)}
                  </p>
                  {room.suspension_reason && (
                    <p className="mt-1 text-xs text-amber-600">Suspended: {room.suspension_reason}</p>
                  )}
                  {room.flag_reason && (
                    <p className="mt-1 text-xs text-orange-600">Flagged: {room.flag_reason}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <button
                    disabled={!!busy}
                    onClick={() => { setEditTarget(room); setEditForm({ name: room.name, description: "", type: room.type, max_members: "" }); }}
                    className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300"
                  >
                    Edit
                  </button>

                  {room.is_active ? (
                    <button
                      disabled={!!busy}
                      onClick={() => doAction(room.id, "set_inactive")}
                      className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      disabled={!!busy}
                      onClick={() => doAction(room.id, "set_active")}
                      className="rounded-lg bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50 dark:bg-green-950 dark:text-green-300"
                    >
                      Activate
                    </button>
                  )}

                  {room.is_suspended ? (
                    <button
                      disabled={!!busy}
                      onClick={() => doAction(room.id, "unsuspend")}
                      className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Unsuspend
                    </button>
                  ) : !room.is_banned && (
                    <button
                      disabled={!!busy}
                      onClick={() => { setSuspendTarget(room); setSuspendReason(""); }}
                      className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200 disabled:opacity-50"
                    >
                      Suspend
                    </button>
                  )}

                  {!room.is_banned && (
                    <button
                      disabled={!!busy}
                      onClick={() => doAction(room.id, "ban")}
                      className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50"
                    >
                      Ban
                    </button>
                  )}

                  {room.flagged_at ? (
                    <button
                      disabled={!!busy}
                      onClick={() => doAction(room.id, "unflag")}
                      className="rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                    >
                      Unflag
                    </button>
                  ) : (
                    <button
                      disabled={!!busy}
                      onClick={() => { setFlagTarget(room); setFlagReason(""); }}
                      className="rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50"
                    >
                      Flag
                    </button>
                  )}

                  {room.monetization_disabled ? (
                    <button
                      disabled={!!busy}
                      onClick={() => doAction(room.id, "enable_monetization")}
                      className="rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                    >
                      Enable $
                    </button>
                  ) : (
                    <button
                      disabled={!!busy}
                      onClick={() => doAction(room.id, "disable_monetization")}
                      className="rounded-lg bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-200 disabled:opacity-50"
                    >
                      Disable $
                    </button>
                  )}

                  <button
                    disabled={!!busy}
                    onClick={() => setDeleteTarget(room)}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              onClick={() => fetchRooms(false)}
              disabled={loading}
              className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}

      {/* Flag modal */}
      {flagTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-3 font-semibold text-neutral-900 dark:text-white">Flag &ldquo;{flagTarget.name}&rdquo;</h3>
            <textarea
              rows={3}
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="Reason for flagging…"
              className="w-full rounded-lg border border-neutral-200 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setFlagTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void submitFlag()} disabled={!flagReason.trim() || !!busy} className="flex-1 rounded-lg bg-orange-600 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">Flag Room</button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend modal */}
      {suspendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-3 font-semibold text-neutral-900 dark:text-white">Suspend &ldquo;{suspendTarget.name}&rdquo;</h3>
            <textarea
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension…"
              className="w-full rounded-lg border border-neutral-200 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setSuspendTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void submitSuspend()} disabled={!suspendReason.trim() || !!busy} className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">Suspend Room</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-4 font-semibold text-neutral-900 dark:text-white">Edit &ldquo;{editTarget.name}&rdquo;</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Room Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Description</label>
                <textarea rows={2} value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Type</label>
                <select value={editForm.type} onChange={(e) => setEditForm(f => ({ ...f, type: e.target.value }))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
                  {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Max Members</label>
                <input type="number" min="2" max="10000" value={editForm.max_members} onChange={(e) => setEditForm(f => ({ ...f, max_members: e.target.value }))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setEditTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void submitEdit()} disabled={!!busy} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-2 font-semibold text-neutral-900 dark:text-white">Delete &ldquo;{deleteTarget.name}&rdquo;?</h3>
            <p className="mb-4 text-sm text-neutral-500">This action is irreversible. The room will be soft-deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void doDelete(deleteTarget.id)} disabled={!!busy} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">Delete Room</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
