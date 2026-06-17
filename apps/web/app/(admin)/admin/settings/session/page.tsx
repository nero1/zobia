"use client";

/**
 * app/(admin)/admin/settings/session/page.tsx
 *
 * Admin panel — Session TTL configuration.
 *
 * Allows admins to configure per-role access and refresh token lifetimes.
 * Changes take effect within 60 seconds (Redis cache TTL).
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionSettingEntry {
  key: string;
  role: string;
  type: "access" | "refresh";
  value: string | null;
  defaultValue: number;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS = [
  { label: "15 min (900)", value: "900" },
  { label: "30 min (1800)", value: "1800" },
  { label: "1 hour (3600)", value: "3600" },
  { label: "8 hours (28800)", value: "28800" },
  { label: "1 day (86400)", value: "86400" },
  { label: "7 days (604800)", value: "604800" },
  { label: "30 days (2592000)", value: "2592000" },
];

// ---------------------------------------------------------------------------
// Role groups
// ---------------------------------------------------------------------------

const ROLE_GROUPS = [
  { role: "default",   label: "Default Users" },
  { role: "creator",   label: "Creators" },
  { role: "moderator", label: "Moderators" },
  { role: "admin",     label: "Admins" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminSessionSettingsPage() {
  const [settings, setSettings] = useState<SessionSettingEntry[]>([]);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);

  const showToast = useCallback((message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/session-settings", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { data: SessionSettingEntry[] };
        setSettings(data.data);
        const initValues: Record<string, string> = {};
        for (const entry of data.data) {
          initValues[entry.key] = entry.value ?? String(entry.defaultValue);
        }
        setLocalValues(initValues);
      } catch {
        showToast("Failed to load settings", true);
      } finally {
        setLoading(false);
      }
    })();
  }, [showToast]);

  async function saveSetting(key: string) {
    const value = localValues[key];
    if (!value) return;
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 60) {
      showToast("Value must be a whole number >= 60 seconds", true);
      return;
    }
    setSaving(key);
    try {
      const res = await fetch("/api/admin/session-settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: String(num) }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err?.error?.message ?? "Failed to save");
      }
      showToast("Saved successfully");
    } catch (e) {
      showToast((e as Error).message ?? "Error saving", true);
    } finally {
      setSaving(null);
    }
  }

  function getEntry(role: string, type: "access" | "refresh"): SessionSettingEntry | undefined {
    return settings.find((s) => s.role === role && s.type === type);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.isError ? "bg-red-600" : "bg-teal-600"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          Session TTL Settings
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Configure how long access and refresh tokens are valid for each user role.
          Changes take effect within 60 seconds (cache TTL).
        </p>
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
          <strong>Access token TTL:</strong> how long before a silent refresh is needed (page navigation triggers it automatically).{" "}
          <strong>Refresh token TTL:</strong> how long the user stays logged in before needing to sign in again.
        </div>
      </div>

      {ROLE_GROUPS.map(({ role, label }) => {
        const accessEntry = getEntry(role, "access");
        const refreshEntry = getEntry(role, "refresh");
        if (!accessEntry || !refreshEntry) return null;

        return (
          <div
            key={role}
            className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {label}
              </h2>
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {[
                { entry: accessEntry, fieldLabel: "Access Token TTL (seconds)" },
                { entry: refreshEntry, fieldLabel: "Refresh Token TTL (seconds)" },
              ].map(({ entry, fieldLabel }) => (
                <div key={entry.key} className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                        {fieldLabel}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        Default: {entry.defaultValue}s ({formatSeconds(entry.defaultValue)})
                        {entry.value && entry.value !== String(entry.defaultValue) && (
                          <span className="ml-2 text-amber-600 dark:text-amber-400">
                            (overridden)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right text-xs text-neutral-400">
                      Current:{" "}
                      <span className="font-semibold">
                        {localValues[entry.key]
                          ? `${localValues[entry.key]}s (${formatSeconds(parseInt(localValues[entry.key], 10) || 0)})`
                          : "—"}
                      </span>
                    </div>
                  </div>

                  {/* Quick-fill presets */}
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() =>
                          setLocalValues((prev) => ({ ...prev, [entry.key]: preset.value }))
                        }
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                          localValues[entry.key] === preset.value
                            ? "bg-blue-600 text-white"
                            : "border border-neutral-300 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={60}
                      step={60}
                      value={localValues[entry.key] ?? ""}
                      onChange={(e) =>
                        setLocalValues((prev) => ({ ...prev, [entry.key]: e.target.value }))
                      }
                      className="w-36 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                      placeholder={String(entry.defaultValue)}
                    />
                    <button
                      type="button"
                      onClick={() => void saveSetting(entry.key)}
                      disabled={saving === entry.key}
                      className="rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {saving === entry.key ? "Saving…" : "Save"}
                    </button>
                    {/* Reset to default */}
                    {localValues[entry.key] !== String(entry.defaultValue) && (
                      <button
                        type="button"
                        onClick={() =>
                          setLocalValues((prev) => ({
                            ...prev,
                            [entry.key]: String(entry.defaultValue),
                          }))
                        }
                        className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
