"use client";

/**
 * app/(admin)/gate44/forum/settings/page.tsx
 *
 * Old-school BB-style forum config — a focused view of x_manifest rows,
 * mirrors app/(admin)/gate44/answers/settings/page.tsx. Also editable at
 * /gate44/config under "Bbforum" (same underlying keys). Admin-only.
 */

import { useState, useEffect, useCallback } from "react";

interface FieldMeta {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number";
}

const FIELDS: FieldMeta[] = [
  { key: "feature_bbforum", label: "Enable Forum", description: "Master toggle. When off, all /forum and /f/<slug> endpoints return 503.", type: "boolean" },
  { key: "bbforum_min_level_to_post", label: "Minimum Level to Create Posts & Replies", description: "Minimum account level required to start a thread OR post a reply.", type: "number" },
  { key: "bbforum_reward_xp_per_thread", label: "XP per Thread", description: "XP awarded for starting a new thread.", type: "number" },
  { key: "bbforum_reward_credits_per_thread", label: "Credits per Thread", description: "Credits awarded for starting a new thread.", type: "number" },
  { key: "bbforum_reward_xp_per_reply", label: "XP per Reply", description: "XP awarded for posting a reply.", type: "number" },
  { key: "bbforum_reward_credits_per_reply", label: "Credits per Reply", description: "Credits awarded for posting a reply.", type: "number" },
  { key: "bbforum_daily_reward_cap_credits", label: "Daily Reward Cap (Credits)", description: "Max forum-sourced credit rewards a user can earn per rolling 24h.", type: "number" },
  { key: "bbforum_auto_moderation_enabled", label: "Auto-Moderation", description: "Run profanity/duplicate-post filters on new threads and posts.", type: "boolean" },
  { key: "bbforum_image_cost_credits", label: "Image Attachment Cost (Credits)", description: "Credits charged to attach an image to a thread/post. 0 = free.", type: "number" },
  { key: "bbforum_image_cost_stars", label: "Image Attachment Cost (Stars)", description: "Stars charged to attach an image to a thread/post. 0 = free.", type: "number" },
  { key: "bbforum_pot_expiry_days", label: "Pot Expiry (Days)", description: "Days of inactivity before an unclaimed thread pot balance auto-refunds to its OP (checked daily).", type: "number" },
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
        <p className="mt-1 text-sm text-neutral-500">Only administrators can change forum settings. Moderators can still use the Boards and Moderation Queue pages.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Forum Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">Also editable at /gate44/config — both write the same values.</p>

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
    </div>
  );
}
