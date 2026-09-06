"use client";

/**
 * app/(admin)/gate44/guilds/page.tsx
 *
 * Admin guild management page. Mirrors app/(admin)/gate44/rooms/page.tsx:
 * search, filter by status, and perform per-guild admin actions —
 * suspend, unsuspend, ban/unban, activate/deactivate, edit details,
 * transfer captaincy, remove any member, delete.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminGuild {
  id: string;
  name: string;
  crest_emoji: string;
  description: string | null;
  city: string | null;
  country: string;
  captain_id: string;
  captain_username: string;
  tier: string;
  member_count: number;
  treasury_balance: string;
  recruitment_type: string;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  is_banned: boolean;
  admin_notes: string | null;
  created_at: string;
}

interface GuildMember {
  id: string;
  user_id: string;
  role: string;
  contribution_score: number;
  war_points_total: number;
  joined_at: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
}

type StatusFilter = "all" | "active" | "inactive" | "suspended" | "banned";

interface EditForm {
  name: string;
  crestEmoji: string;
  description: string;
  city: string;
  country: string;
  recruitmentType: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "suspended", label: "Suspended" },
  { key: "banned", label: "Banned" },
];

const RECRUITMENT_TYPES = ["open", "approval", "invite_only"];

function StatusBadge({ guild }: { guild: AdminGuild }) {
  if (guild.is_banned) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Banned</span>;
  if (guild.is_suspended) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Suspended</span>;
  if (guild.is_active) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Active</span>;
  return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">Inactive</span>;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminGuildsPage() {
  const [guilds, setGuilds] = useState<AdminGuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Modal states
  const [suspendTarget, setSuspendTarget] = useState<AdminGuild | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [editTarget, setEditTarget] = useState<AdminGuild | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: "", crestEmoji: "", description: "", city: "", country: "", recruitmentType: "open" });
  const [deleteTarget, setDeleteTarget] = useState<AdminGuild | null>(null);
  const [membersTarget, setMembersTarget] = useState<AdminGuild | null>(null);
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [transferTarget, setTransferTarget] = useState<GuildMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<GuildMember | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchGuilds = useCallback(async (reset = true) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "20" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (!reset && cursor) params.set("cursor", cursor);

    try {
      const res = await fetch(`/api/admin/guilds?${params}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        setGuilds(prev => reset ? json.data.guilds : [...prev, ...json.data.guilds]);
        setCursor(json.data.pagination.nextCursor ?? null);
        setHasMore(!!json.data.pagination.nextCursor);
      } else {
        showToast(json.error?.message ?? "Failed to load guilds", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, cursor, showToast]);

  useEffect(() => {
    void fetchGuilds(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, debouncedSearch]);

  async function doAction(guildId: string, action: string, extra?: Record<string, unknown>) {
    setBusy(guildId);
    try {
      const res = await fetch(`/api/admin/guilds/${guildId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (json.success) {
        showToast("Action applied");
        await fetchGuilds(true);
        if (membersTarget?.id === guildId) await loadMembers(guildId);
        return true;
      } else {
        showToast(json.error?.message ?? "Action failed", "error");
        return false;
      }
    } catch {
      showToast("Network error", "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(guildId: string) {
    setBusy(guildId);
    try {
      const res = await fetch(`/api/admin/guilds/${guildId}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (json.success) {
        showToast("Guild deleted");
        setDeleteTarget(null);
        await fetchGuilds(true);
      } else {
        showToast(json.error?.message ?? "Delete failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusy(null);
    }
  }

  async function loadMembers(guildId: string) {
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/admin/guilds/${guildId}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) setMembers(json.data.members);
    } catch {
      showToast("Failed to load members", "error");
    } finally {
      setMembersLoading(false);
    }
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
    if (editForm.crestEmoji.trim()) payload.crestEmoji = editForm.crestEmoji.trim();
    if (editForm.description !== (editTarget.description ?? "")) payload.description = editForm.description.trim();
    if (editForm.city !== (editTarget.city ?? "")) payload.city = editForm.city.trim();
    if (editForm.country.trim()) payload.country = editForm.country.trim().toUpperCase();
    if (editForm.recruitmentType) payload.recruitmentType = editForm.recruitmentType;
    await doAction(editTarget.id, "update_details", payload);
    setEditTarget(null);
  }

  async function submitTransfer() {
    if (!membersTarget || !transferTarget) return;
    const ok = await doAction(membersTarget.id, "transfer_captain", { newCaptainUserId: transferTarget.user_id });
    if (ok) setTransferTarget(null);
  }

  async function submitRemove() {
    if (!membersTarget || !removeTarget) return;
    const ok = await doAction(membersTarget.id, "remove_member", { userId: removeTarget.user_id });
    if (ok) setRemoveTarget(null);
  }

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Guild Management</h1>

      {toast && (
        <div className={`fixed bottom-4 right-4 left-4 sm:left-auto z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search guilds by name or captain…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {STATUS_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`flex-1 min-w-[4.5rem] rounded-lg px-2 py-1.5 text-xs sm:text-sm font-semibold transition-colors ${
              statusFilter === key
                ? "bg-white text-neutral-900 shadow dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && guilds.length === 0 ? (
        <div className="text-center py-12 text-neutral-500">Loading guilds…</div>
      ) : guilds.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-500">
          No guilds found.
        </div>
      ) : (
        <div className="space-y-3">
          {guilds.map((guild) => (
            <div key={guild.id} className="rounded-xl border border-neutral-200 bg-white p-3 sm:p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-lg" aria-hidden="true">{guild.crest_emoji}</span>
                    <span className="font-semibold text-neutral-900 dark:text-white truncate">{guild.name}</span>
                    <StatusBadge guild={guild} />
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{guild.tier}</span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Captain @{guild.captain_username} · {guild.member_count} members · {guild.city ? `${guild.city}, ` : ""}{guild.country} · Created {formatDate(guild.created_at)}
                  </p>
                  {guild.suspension_reason && (
                    <p className="mt-1 text-xs text-amber-600">Suspended: {guild.suspension_reason}</p>
                  )}
                  {guild.admin_notes && (
                    <p className="mt-1 text-xs text-neutral-500">Notes: {guild.admin_notes}</p>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 sm:shrink-0 sm:justify-end">
                  <a
                    href={`/guilds/${guild.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100 dark:bg-teal-950 dark:text-teal-300"
                  >
                    View ↗
                  </a>

                  <button
                    disabled={!!busy}
                    onClick={() => { setMembersTarget(guild); void loadMembers(guild.id); }}
                    className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-950 dark:text-indigo-300"
                  >
                    Members
                  </button>

                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setEditTarget(guild);
                      setEditForm({
                        name: guild.name,
                        crestEmoji: guild.crest_emoji,
                        description: guild.description ?? "",
                        city: guild.city ?? "",
                        country: guild.country,
                        recruitmentType: guild.recruitment_type,
                      });
                    }}
                    className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300"
                  >
                    Edit
                  </button>

                  {guild.is_active ? (
                    <button disabled={!!busy} onClick={() => doAction(guild.id, "set_inactive")} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">
                      Disable
                    </button>
                  ) : (
                    <button disabled={!!busy} onClick={() => doAction(guild.id, "set_active")} className="rounded-lg bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50 dark:bg-green-950 dark:text-green-300">
                      Enable
                    </button>
                  )}

                  {guild.is_suspended ? (
                    <button disabled={!!busy} onClick={() => doAction(guild.id, "unsuspend")} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                      Unsuspend
                    </button>
                  ) : !guild.is_banned && (
                    <button disabled={!!busy} onClick={() => { setSuspendTarget(guild); setSuspendReason(""); }} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200 disabled:opacity-50">
                      Suspend
                    </button>
                  )}

                  {guild.is_banned ? (
                    <button disabled={!!busy} onClick={() => doAction(guild.id, "unban")} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                      Unban
                    </button>
                  ) : (
                    <button disabled={!!busy} onClick={() => doAction(guild.id, "ban")} className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50">
                      Ban
                    </button>
                  )}

                  <button disabled={!!busy} onClick={() => setDeleteTarget(guild)} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}

          {hasMore && (
            <button onClick={() => fetchGuilds(false)} disabled={loading} className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700">
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}

      {/* Suspend modal */}
      {suspendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-3 font-semibold text-neutral-900 dark:text-white">Suspend &ldquo;{suspendTarget.name}&rdquo;</h3>
            <textarea rows={3} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Reason for suspension…" className="w-full rounded-lg border border-neutral-200 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setSuspendTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void submitSuspend()} disabled={!suspendReason.trim() || !!busy} className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">Suspend Guild</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900 max-h-[90vh] overflow-y-auto">
            <h3 className="mb-4 font-semibold text-neutral-900 dark:text-white">Edit &ldquo;{editTarget.name}&rdquo;</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Guild Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Crest Emoji</label>
                <input value={editForm.crestEmoji} onChange={(e) => setEditForm(f => ({ ...f, crestEmoji: e.target.value }))} maxLength={4} className="w-20 rounded-lg border border-neutral-200 px-3 py-2 text-center text-lg dark:border-neutral-700 dark:bg-neutral-800" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Description</label>
                <textarea rows={2} value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">City</label>
                  <input value={editForm.city} onChange={(e) => setEditForm(f => ({ ...f, city: e.target.value }))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
                </div>
                <div className="w-20">
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Country</label>
                  <input value={editForm.country} onChange={(e) => setEditForm(f => ({ ...f, country: e.target.value.toUpperCase() }))} maxLength={2} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm uppercase dark:border-neutral-700 dark:bg-neutral-800" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Recruitment</label>
                <select value={editForm.recruitmentType} onChange={(e) => setEditForm(f => ({ ...f, recruitmentType: e.target.value }))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
                  {RECRUITMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
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
            <p className="mb-4 text-sm text-neutral-500">This action is irreversible. The guild will be soft-deleted and all members removed.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void doDelete(deleteTarget.id)} disabled={!!busy} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">Delete Guild</button>
            </div>
          </div>
        </div>
      )}

      {/* Members modal */}
      {membersTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setMembersTarget(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 dark:bg-neutral-900 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-semibold text-neutral-900 dark:text-white">
              {membersTarget.crest_emoji} {membersTarget.name} — Members
            </h3>
            {membersLoading ? (
              <p className="text-sm text-neutral-500">Loading…</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-neutral-500">No members.</p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 p-2.5 text-sm dark:border-neutral-800">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                        {m.avatar_emoji ?? "👤"} {m.display_name ?? m.username} <span className="text-xs text-neutral-500">@{m.username}</span>
                      </p>
                      <p className="text-xs text-neutral-500 capitalize">{m.role} · {m.contribution_score} contribution</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {m.role !== "captain" && (
                        <button
                          disabled={!!busy}
                          onClick={() => setTransferTarget(m)}
                          className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-950 dark:text-indigo-300"
                        >
                          Make Captain
                        </button>
                      )}
                      {m.role !== "captain" && (
                        <button
                          disabled={!!busy}
                          onClick={() => setRemoveTarget(m)}
                          className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <button onClick={() => setMembersTarget(null)} className="w-full rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer captain confirm */}
      {transferTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-2 font-semibold text-neutral-900 dark:text-white">Make @{transferTarget.username} the captain?</h3>
            <p className="mb-4 text-sm text-neutral-500">The current captain will be demoted to Veteran.</p>
            <div className="flex gap-2">
              <button onClick={() => setTransferTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void submitTransfer()} disabled={!!busy} className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Transfer Captaincy</button>
            </div>
          </div>
        </div>
      )}

      {/* Remove member confirm */}
      {removeTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-2 font-semibold text-neutral-900 dark:text-white">Remove @{removeTarget.username} from the guild?</h3>
            <div className="flex gap-2">
              <button onClick={() => setRemoveTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700">Cancel</button>
              <button onClick={() => void submitRemove()} disabled={!!busy} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
