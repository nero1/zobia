"use client";

/**
 * app/(admin)/admin/announcements/page.tsx
 *
 * Announcement management for admin panel.
 * Manage modal and banner announcements with scheduling,
 * audience targeting, and display mode configuration.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnnType = "modal" | "banner";
type AnnStatus = "active" | "inactive" | "scheduled";
type DisplayMode = "serial" | "random";

interface Announcement {
  id: string;
  type: AnnType;
  title?: string; // modals only
  content: string;
  status: AnnStatus;
  audience: {
    plans: string[];
    roles: string[];
  };
  startAt: string | null;
  endAt: string | null;
  displayOrder: number;
}

type TabKey = "modals" | "banners";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16);
}

function formatDateDisplay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<AnnStatus, string> = {
  active: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  inactive: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
};

const PLAN_OPTIONS = ["free", "basic", "pro", "vip"];
const ROLE_OPTIONS = ["user", "creator", "moderator", "admin"];

// ---------------------------------------------------------------------------
// Announcement form
// ---------------------------------------------------------------------------

interface AnnFormProps {
  type: AnnType;
  initial?: Partial<Announcement>;
  onSave: (data: Omit<Announcement, "id">) => Promise<void>;
  onCancel: () => void;
}

function AnnForm({ type, initial, onSave, onCancel }: AnnFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [startAt, setStartAt] = useState(formatDateInput(initial?.startAt ?? null));
  const [endAt, setEndAt] = useState(formatDateInput(initial?.endAt ?? null));
  const [selectedPlans, setSelectedPlans] = useState<string[]>(initial?.audience?.plans ?? []);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(initial?.audience?.roles ?? []);
  const [displayOrder, setDisplayOrder] = useState(initial?.displayOrder ?? 1);
  const [status, setStatus] = useState<AnnStatus>(initial?.status ?? "inactive");
  const [saving, setSaving] = useState(false);

  function toggleArr<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        type,
        title: type === "modal" ? title : undefined,
        content,
        status,
        audience: { plans: selectedPlans, roles: selectedRoles },
        startAt: startAt || null,
        endAt: endAt || null,
        displayOrder,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/30">
      {type === "modal" && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Title</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="Announcement title"
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Content</label>
        <textarea
          required
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          placeholder="HTML or plain text content…"
        />
        <p className="mt-1 text-xs text-neutral-400">Supports basic HTML. Content is sanitized before display.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Start</label>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">End</label>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
        </div>
      </div>

      {type === "modal" && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Display Order (1–5)</label>
          <input
            type="number"
            min={1}
            max={5}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(Number(e.target.value))}
            className="w-24 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-6">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Plans</p>
          <div className="flex flex-wrap gap-2">
            {PLAN_OPTIONS.map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selectedPlans.includes(p)}
                  onChange={() => setSelectedPlans(toggleArr(selectedPlans, p))}
                  className="rounded border-neutral-300"
                />
                {p}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Roles</p>
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(r)}
                  onChange={() => setSelectedRoles(toggleArr(selectedRoles, r))}
                  className="rounded border-neutral-300"
                />
                {r}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as AnnStatus)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
          <option value="inactive">Inactive</option>
          <option value="active">Active</option>
          <option value="scheduled">Scheduled</option>
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Announcement row
// ---------------------------------------------------------------------------

interface AnnRowProps {
  ann: Announcement;
  onToggle: (id: string, status: AnnStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (ann: Announcement) => void;
  busy: string | null;
}

function AnnRow({ ann, onToggle, onDelete, onEdit, busy }: AnnRowProps) {
  const isBusy = busy === ann.id;
  const nextStatus: AnnStatus = ann.status === "active" ? "inactive" : "active";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="min-w-0 flex-1">
        {ann.title && <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{ann.title}</p>}
        <p className="line-clamp-2 text-xs text-neutral-500" dangerouslySetInnerHTML={{ __html: ann.content.slice(0, 120) }} />
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_BADGE[ann.status]}`}>{ann.status}</span>
          {ann.audience.plans.length > 0 && <span>Plans: {ann.audience.plans.join(", ")}</span>}
          <span>{formatDateDisplay(ann.startAt)} — {formatDateDisplay(ann.endAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => onEdit(ann)} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300">Edit</button>
        <button disabled={isBusy} onClick={() => onToggle(ann.id, nextStatus)} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">
          {isBusy ? "…" : ann.status === "active" ? "Deactivate" : "Activate"}
        </button>
        <button disabled={isBusy} onClick={() => onDelete(ann.id)} className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300">Delete</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin announcements management page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminAnnouncementsPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [tab, setTab] = useState<TabKey>("modals");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("serial");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/announcements?type=${tab === "modals" ? "modal" : "banner"}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error?.message ?? "Failed to load announcements") as Error & { code?: string | null };
        err.code = body.error?.code ?? null;
        throw err;
      }
      const data = (await res.json()) as { announcements: Announcement[]; displayMode: DisplayMode };
      setAnnouncements(data.announcements);
      setDisplayMode(data.displayMode);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void fetchAnnouncements(); }, [fetchAnnouncements]);

  async function handleSaveDisplayMode(mode: DisplayMode) {
    try {
      await fetch("/api/admin/announcements/display-mode", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      setDisplayMode(mode);
      showToast("Display mode saved");
    } catch {
      showToast("Failed to save display mode", "error");
    }
  }

  async function handleCreate(formData: Omit<Announcement, "id">) {
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!res.ok) { showToast("Failed to create", "error"); return; }
    showToast("Announcement created");
    setCreating(false);
    await fetchAnnouncements();
  }

  async function handleEdit(id: string, formData: Omit<Announcement, "id">) {
    const res = await fetch(`/api/admin/announcements/${id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!res.ok) { showToast("Failed to update", "error"); return; }
    showToast("Announcement updated");
    setEditing(null);
    await fetchAnnouncements();
  }

  async function handleToggle(id: string, status: AnnStatus) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error?.message ?? "Failed to update status") as Error & { code?: string | null };
        err.code = body.error?.code ?? null;
        throw err;
      }
      showToast("Status updated");
      await fetchAnnouncements();
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(e instanceof Error ? translateApiError(t, err.code, err.message || "Error") : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this announcement?")) return;
    setBusy(id);
    try {
      await fetch(`/api/admin/announcements/${id}`, { method: "DELETE", credentials: "include" });
      showToast("Deleted");
      await fetchAnnouncements();
    } catch {
      showToast("Failed to delete", "error");
    } finally {
      setBusy(null);
    }
  }

  const annType: AnnType = tab === "modals" ? "modal" : "banner";
  const maxSlots = tab === "modals" ? 5 : Infinity;
  const canCreate = announcements.length < maxSlots;

  return (
    <div className="relative space-y-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Announcements</h1>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Display mode */}
      <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Display Mode</p>
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-800">
          {(["serial", "random"] as DisplayMode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleSaveDisplayMode(m)}
              className={`rounded px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${displayMode === m ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-700 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-400">Saved to x_manifest</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {(["modals", "banners"] as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setCreating(false); setEditing(null); }}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${tab === t ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {/* List */}
      <div className="space-y-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-2 h-5 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
            </div>
          ))
          : announcements.length === 0
          ? (
            <div className="rounded-xl border border-neutral-200 bg-white py-12 text-center dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-neutral-500">No {tab} yet</p>
            </div>
          )
          : announcements.map((ann) =>
            editing?.id === ann.id ? (
              <AnnForm
                key={ann.id}
                type={annType}
                initial={ann}
                onSave={(data) => handleEdit(ann.id, data)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <AnnRow
                key={ann.id}
                ann={ann}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onEdit={setEditing}
                busy={busy}
              />
            )
          )}
      </div>

      {/* Create form / button */}
      {creating ? (
        <AnnForm
          type={annType}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          disabled={!canCreate}
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-xl border-2 border-dashed border-blue-300 px-5 py-4 text-sm font-semibold text-blue-600 hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
        >
          + Create {tab === "modals" ? "Modal" : "Banner"}
          {tab === "modals" && <span className="text-xs font-normal text-neutral-400">({announcements.length}/5 slots used)</span>}
        </button>
      )}
    </div>
  );
}
