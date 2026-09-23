"use client";

/**
 * app/(admin)/gate44/users/page.tsx
 *
 * Admin user management page.
 *
 * "Users" tab: thin wrapper around the shared components/admin/UserManagementTable
 * — extracted so the same search/list/detail/impersonate/suspend/ban UI can
 * also be embedded in the Users tab of /gate44/data-management. This tab's
 * own behavior is unchanged: no selection checkboxes, no delete action
 * (`embedded` defaults to false).
 *
 * "Settings" tab: user-related settings appropriately mirrored from the
 * central site settings panel (/gate44/config) — currently just the new
 * signups toggle. NOTE: signups_enabled is ALSO editable at /gate44/config;
 * both write the same x_manifest key, so keep both UIs in sync if you
 * change this key or its default.
 */

import { useState, useEffect, useCallback } from "react";
import UserManagementTable from "@/components/admin/UserManagementTable";

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

function UserSettingsTab() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
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
  }, [showToast]);

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

  if (loading) {
    return <div className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  }

  return (
    <div className="relative">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">New Signups Enabled</p>
            <p className="text-xs text-neutral-500">
              When off, new Google/Telegram sign-ins are refused (existing users can still log in). Also editable at
              /gate44/config.
            </p>
          </div>
          <ToggleSwitch
            checked={(values["signups_enabled"] ?? "true") === "true"}
            disabled={saving === "signups_enabled"}
            onChange={(v) => save("signups_enabled", v ? "true" : "false")}
          />
        </div>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const [tab, setTab] = useState<"users" | "settings">("users");

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">User Management</h1>

      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-800 w-fit">
        {(["users", "settings"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              tab === tabKey
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {tabKey}
          </button>
        ))}
      </div>

      {tab === "users" ? <UserManagementTable /> : <UserSettingsTab />}
    </div>
  );
}
