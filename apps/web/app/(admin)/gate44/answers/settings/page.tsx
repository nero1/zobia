"use client";

/**
 * app/(admin)/admin/forum/settings/page.tsx
 *
 * Answers config — a focused view of the same x_manifest rows also
 * editable at /gate44/config under the "Answers" group. Both surfaces
 * write the same rows via PUT /api/admin/config/[key] and call
 * invalidateManifestCache() server-side, so edits here and at /gate44/config
 * are immediately consistent.
 *
 * Admin-only — the underlying config write endpoint is admin-only
 * (config changes are a platform-wide decision, unlike moderation actions
 * which moderators can also take on /gate44/answers/queue and /gate44/answers/posts).
 */

import { useState, useEffect, useCallback } from "react";

interface FieldMeta {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number";
}

const FIELDS: FieldMeta[] = [
  { key: "feature_forum", label: "Enable Answers", description: "Master toggle. When off, all /answers endpoints return 503.", type: "boolean" },
  { key: "forum_min_level_to_post", label: "Minimum Level to Post", description: "Minimum account level required to post a question.", type: "number" },
  { key: "forum_min_level_to_comment", label: "Minimum Level to Comment (Free)", description: "Below this level, users can still comment by spending credits.", type: "number" },
  { key: "forum_comment_bypass_cost_credits", label: "Comment Bypass Cost (Credits)", description: "Credits charged to comment when below the comment level gate.", type: "number" },
  { key: "forum_reward_xp_per_question", label: "XP per Question", description: "XP awarded for posting a question.", type: "number" },
  { key: "forum_reward_credits_per_question", label: "Credits per Question", description: "Credits awarded for posting a question.", type: "number" },
  { key: "forum_reward_xp_per_answer", label: "XP per Answer", description: "XP awarded for posting an answer.", type: "number" },
  { key: "forum_reward_credits_per_answer", label: "Credits per Answer", description: "Credits awarded for posting an answer.", type: "number" },
  { key: "forum_reward_xp_per_upvote", label: "XP per Upvote Received", description: "XP awarded to a content author per upvote received.", type: "number" },
  { key: "forum_reward_credits_per_upvote", label: "Credits per Upvote Received", description: "Credits awarded to a content author per upvote received.", type: "number" },
  { key: "forum_reward_xp_best_answer", label: "XP for Best Answer", description: "XP awarded when an answer is marked best.", type: "number" },
  { key: "forum_reward_credits_best_answer", label: "Credits for Best Answer", description: "Credits awarded when an answer is marked best.", type: "number" },
  { key: "forum_daily_reward_cap_credits", label: "Daily Reward Cap (Credits)", description: "Max forum-sourced credit rewards a user can earn per rolling 24h.", type: "number" },
  { key: "forum_auto_moderation_enabled", label: "Auto-Moderation", description: "Run profanity/duplicate-post filters on new questions and answers.", type: "boolean" },
];

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-primary-600" : "bg-neutral-300 dark:bg-neutral-700"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon_emoji: string;
  sort_order: number;
  question_count: string;
}

function CategoriesManager({ showToast }: { showToast: (msg: string, type?: "success" | "error") => void }) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💬");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/forum/categories", { credentials: "include" });
    const json = await res.json().catch(() => null);
    if (json?.success) setCategories(json.data.categories);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const res = await fetch("/api/admin/forum/categories", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), iconEmoji: icon || "💬" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to create category");
      setName(""); setIcon("💬");
      showToast("Category created");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to create category", "error");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this category? This can't be undone.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/forum/categories/${id}`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to delete category");
      showToast("Category deleted");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete category", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(id: string, currentName: string) {
    const next = window.prompt("New category name:", currentName);
    if (!next || next.trim() === currentName) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/forum/categories/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next.trim() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to rename category");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to rename category", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-8">
      <h2 className="mb-2 text-lg font-bold text-neutral-900 dark:text-neutral-50">Categories</h2>
      <div className="mb-3 flex gap-2">
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          className="w-14 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-center text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
          placeholder="🙏"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
        />
        <button onClick={handleCreate} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700">Add</button>
      </div>
      {loading ? (
        <div className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
      ) : (
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span>{c.icon_emoji}</span>
                <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">{c.name}</span>
                <span className="text-xs text-neutral-400">({c.question_count})</span>
              </div>
              <div className="flex shrink-0 gap-2">
                <button disabled={busyId === c.id} onClick={() => handleRename(c.id, c.name)} className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900 dark:text-blue-300">Rename</button>
                <button disabled={busyId === c.id} onClick={() => handleDelete(c.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-950 dark:text-red-300">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminForumSettingsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setIsAdmin(!!(json?.user ?? json)?.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    fetch("/api/admin/config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const entries: { key: string; value: string }[] = json?.data ?? json?.entries ?? [];
        const map: Record<string, string> = {};
        for (const e of entries) map[e.key] = e.value;
        setValues(map);
      })
      .catch(() => showToast("Failed to load settings", "error"))
      .finally(() => setLoading(false));
  }, [isAdmin, showToast]);

  async function save(key: string, value: string) {
    setSaving(key);
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Save failed");
      setValues((prev) => ({ ...prev, [key]: value }));
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(null);
    }
  }

  if (isAdmin === false) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">Admin access required</p>
        <p className="mt-1 text-sm text-neutral-500">Only administrators can change Answers settings. Moderators can still use the Moderation Queue and Manage Posts pages.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Answers Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">Also editable at /gate44/config under &quot;Answers&quot; — both write the same values.</p>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {loading || isAdmin === null ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
        </div>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {FIELDS.map((field) => {
            const raw = values[field.key] ?? "";
            const isSaving = saving === field.key;
            return (
              <div key={field.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{field.label}</p>
                  <p className="text-xs text-neutral-500">{field.description}</p>
                </div>
                {field.type === "boolean" ? (
                  <ToggleSwitch checked={raw === "true"} disabled={isSaving} onChange={(v) => save(field.key, v ? "true" : "false")} />
                ) : (
                  <input
                    type="number"
                    defaultValue={raw}
                    disabled={isSaving}
                    onBlur={(e) => { if (e.target.value !== raw) save(field.key, e.target.value); }}
                    className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <CategoriesManager showToast={showToast} />
    </div>
  );
}
