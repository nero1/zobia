"use client";

/**
 * app/(admin)/admin/config/page.tsx
 *
 * Platform configuration page for admin panel.
 * Grouped settings with inline editing, toggle switches for booleans,
 * and per-key save via PUT /api/admin/config/[key].
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConfigValueType = "boolean" | "string" | "number";

interface ConfigItem {
  key: string;
  label: string;
  description: string;
  value: boolean | string | number;
  type: ConfigValueType;
  group: string;
}

type GroupedConfig = Record<string, ConfigItem[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUP_ORDER = [
  "Auth",
  "Features",
  "Payments",
  "Economy",
  "Email",
  "CAPTCHA",
  "AdMob",
  "Limits",
  "Miscellaneous",
];

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}

function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-blue-600" : "bg-neutral-300 dark:bg-neutral-600"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-card transition duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline edit field
// ---------------------------------------------------------------------------

interface InlineEditProps {
  item: ConfigItem;
  onSave: (key: string, value: boolean | string | number) => Promise<void>;
}

function ConfigRow({ item, onSave }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState<string>(String(item.value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleToggle(val: boolean) {
    setSaving(true);
    await onSave(item.key, val);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSaveText() {
    setSaving(true);
    const parsed: boolean | string | number =
      item.type === "number" ? Number(localValue) : localValue;
    await onSave(item.key, parsed);
    setEditing(false);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-wrap items-start gap-4 border-b border-neutral-100 py-4 last:border-0 dark:border-neutral-800">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{item.key}</span>
          {saved && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">Saved ✓</span>}
        </div>
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.label}</p>
        <p className="text-xs text-neutral-500">{item.description}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {item.type === "boolean" ? (
          <ToggleSwitch
            checked={item.value as boolean}
            onChange={handleToggle}
            disabled={saving}
          />
        ) : editing ? (
          <div className="flex items-center gap-2">
            <input
              type={item.type === "number" ? "number" : "text"}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              className="w-40 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              autoFocus
            />
            <button
              onClick={handleSaveText}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setLocalValue(String(item.value)); }}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-neutral-100 px-2.5 py-1 font-mono text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {String(item.value)}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg bg-blue-100 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300"
            >
              Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin platform configuration page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminConfigPage() {
  const [grouped, setGrouped] = useState<GroupedConfig>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(GROUP_ORDER.map((g) => [g, true]))
  );

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/config", { credentials: "include" });
        if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
        if (!res.ok) throw new Error("Failed to load config");
        const data = (await res.json()) as { config: ConfigItem[] };
        const g: GroupedConfig = {};
        for (const item of data.config) {
          const group = item.group || "Miscellaneous";
          if (!g[group]) g[group] = [];
          g[group].push(item);
        }
        setGrouped(g);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(key: string, value: boolean | string | number) {
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      // Update local state
      setGrouped((prev) => {
        const next: GroupedConfig = {};
        for (const [g, items] of Object.entries(prev)) {
          next[g] = items.map((i) => (i.key === key ? { ...i, value } : i));
        }
        return next;
      });
      showToast(`${key} saved`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
      throw e;
    }
  }

  function toggleGroup(g: string) {
    setOpenGroups((prev) => ({ ...prev, [g]: !prev[g] }));
  }

  const sortedGroups = GROUP_ORDER.filter((g) => grouped[g]).concat(
    Object.keys(grouped).filter((g) => !GROUP_ORDER.includes(g))
  );

  return (
    <div className="relative space-y-4">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Platform Configuration</h1>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-4 h-5 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="mb-3 flex items-center justify-between">
                  <div className="h-4 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="h-6 w-11 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        sortedGroups.map((group) => (
          <div key={group} className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
            <button
              onClick={() => toggleGroup(group)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div>
                <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{group}</h2>
                <p className="text-xs text-neutral-500">{grouped[group]?.length ?? 0} settings</p>
              </div>
              <span className="text-neutral-400">{openGroups[group] ? "▲" : "▼"}</span>
            </button>
            {openGroups[group] && (
              <div className="border-t border-neutral-100 px-5 dark:border-neutral-800">
                {grouped[group]?.map((item) => (
                  <ConfigRow key={item.key} item={item} onSave={handleSave} />
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
