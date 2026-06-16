"use client";

/**
 * app/(admin)/admin/footer-scripts/page.tsx
 *
 * Footer Script Manager for admin panel.
 * Allows admins to view, create, edit, toggle, and delete footer scripts
 * that are injected into the site footer server-side.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FooterScript {
  id: string;
  name: string;
  content: string;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(isActive: boolean) {
  return isActive
    ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300"
    : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
}

// ---------------------------------------------------------------------------
// New / Edit Script Form
// ---------------------------------------------------------------------------

interface ScriptFormProps {
  initial?: Partial<FooterScript>;
  onSave: (data: { name: string; content: string; isActive: boolean; position: number }) => Promise<void>;
  onCancel: () => void;
}

function ScriptForm({ initial, onSave, onCancel }: ScriptFormProps) {
  const { t: tSub } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [position, setPosition] = useState(initial?.position ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({ name, content, isActive, position });
    } catch (err) {
      setError(err instanceof Error ? translateApiError(tSub, (err as Error & { code?: string | null }).code, err.message || "Failed to save script") : "Failed to save script");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/30"
    >
      <h3 className="mb-4 text-sm font-bold text-neutral-800 dark:text-neutral-200">
        {initial?.id ? "Edit Script" : "New Footer Script"}
      </h3>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Name
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="e.g. Google Analytics, Intercom"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Content
          </label>
          <textarea
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder={"<script>\n  // Your script here\n</script>"}
          />
          <p className="mt-1 text-xs text-neutral-400">
            HTML, JS, or CSS injected into the site footer server-side. Admin-only. Content is sanitised.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Position
            </label>
            <input
              type="number"
              min={0}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="w-24 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div className="flex items-center gap-2 pt-4">
            <input
              id="script-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300"
            />
            <label htmlFor="script-active" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Active
            </label>
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Script"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Script Row
// ---------------------------------------------------------------------------

interface ScriptRowProps {
  script: FooterScript;
  onEdit: (script: FooterScript) => void;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  busy: string | null;
}

function ScriptRow({ script, onEdit, onToggle, onDelete, busy }: ScriptRowProps) {
  const isBusy = busy === script.id;
  const preview = script.content.slice(0, 80) + (script.content.length > 80 ? "…" : "");

  return (
    <tr className="border-b border-neutral-200 last:border-0 dark:border-neutral-800">
      <td className="py-3 pl-4 pr-3 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {script.name}
      </td>
      <td className="px-3 py-3 font-mono text-xs text-neutral-500 dark:text-neutral-400">
        <span title={script.content}>{preview}</span>
      </td>
      <td className="px-3 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(script.isActive)}`}
        >
          {script.isActive ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-3 py-3 text-sm text-neutral-600 dark:text-neutral-400">
        {script.position}
      </td>
      <td className="py-3 pl-3 pr-4">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onEdit(script)}
            className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
          >
            Edit
          </button>
          <button
            disabled={isBusy}
            onClick={() => onToggle(script.id, !script.isActive)}
            className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {isBusy ? "…" : script.isActive ? "Deactivate" : "Activate"}
          </button>
          <button
            disabled={isBusy}
            onClick={() => onDelete(script.id)}
            className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-neutral-200 dark:border-neutral-800">
      {[1, 2, 3, 4, 5].map((i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-4 rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin Footer Script Manager page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminFooterScriptsPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [scripts, setScripts] = useState<FooterScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FooterScript | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchScripts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/footer-scripts", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load footer scripts");
      const data = (await res.json()) as { data: { scripts: FooterScript[] } };
      setScripts(data.data.scripts);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchScripts();
  }, [fetchScripts]);

  async function handleCreate(formData: { name: string; content: string; isActive: boolean; position: number }) {
    const res = await fetch("/api/admin/footer-scripts", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error((json as { error?: { message?: string } })?.error?.message ?? "Failed to create script");
    }
    showToast("Script created");
    setCreating(false);
    await fetchScripts();
  }

  async function handleUpdate(id: string, formData: { name: string; content: string; isActive: boolean; position: number }) {
    const res = await fetch(`/api/admin/footer-scripts/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error((json as { error?: { message?: string } })?.error?.message ?? "Failed to update script");
    }
    showToast("Script updated");
    setEditing(null);
    await fetchScripts();
  }

  async function handleToggle(id: string, isActive: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/footer-scripts/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      showToast(`Script ${isActive ? "activated" : "deactivated"}`);
      await fetchScripts();
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Error") : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this footer script? This cannot be undone.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/footer-scripts/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete script");
      showToast("Script deleted");
      await fetchScripts();
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Error") : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Footer Scripts</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Manage scripts injected into the site footer. Useful for analytics, chat widgets, and third-party integrations.
          </p>
        </div>
        {!creating && !editing && (
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + New Script
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Create form */}
      {creating && (
        <ScriptForm
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Edit form */}
      {editing && (
        <ScriptForm
          initial={editing}
          onSave={(data) => handleUpdate(editing.id, data)}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-800">
          <thead>
            <tr className="bg-neutral-50 dark:bg-neutral-800/50">
              <th className="py-3 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Name
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Content Preview
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Status
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Position
              </th>
              <th className="py-3 pl-3 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            ) : scripts.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="py-12 text-center text-sm text-neutral-500 dark:text-neutral-400"
                >
                  No footer scripts yet. Click &quot;New Script&quot; to add one.
                </td>
              </tr>
            ) : (
              scripts.map((script) => (
                <ScriptRow
                  key={script.id}
                  script={script}
                  onEdit={setEditing}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  busy={busy}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
