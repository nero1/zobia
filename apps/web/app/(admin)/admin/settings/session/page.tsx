"use client";

/**
 * app/(admin)/admin/settings/session/page.tsx
 *
 * Admin panel — Session TTL configuration.
 *
 * Reads from GET /api/admin/config (x_manifest table) and writes via
 * PUT /api/admin/config/[key]. Falls back to hardcoded defaults when a key
 * has no DB row yet (first save creates the row via UPSERT).
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Constants — must match DEFAULT_MANIFEST.sessionTtls in lib/manifest/index.ts
// ---------------------------------------------------------------------------

const SESSION_TTL_KEYS = [
  { key: "session_ttl_access_default",    role: "default",   type: "access",  defaultValue: 86400 },
  { key: "session_ttl_refresh_default",   role: "default",   type: "refresh", defaultValue: 2592000 },
  { key: "session_ttl_access_creator",    role: "creator",   type: "access",  defaultValue: 86400 },
  { key: "session_ttl_refresh_creator",   role: "creator",   type: "refresh", defaultValue: 2592000 },
  { key: "session_ttl_access_moderator",  role: "moderator", type: "access",  defaultValue: 21600 },
  { key: "session_ttl_refresh_moderator", role: "moderator", type: "refresh", defaultValue: 2592000 },
  { key: "session_ttl_access_admin",      role: "admin",     type: "access",  defaultValue: 3600 },
  { key: "session_ttl_refresh_admin",     role: "admin",     type: "refresh", defaultValue: 3600 },
] as const;

const ROLE_GROUPS = [
  { role: "default",   label: "Default Users" },
  { role: "creator",   label: "Creators" },
  { role: "moderator", label: "Moderators" },
  { role: "admin",     label: "Admins" },
] as const;

const PRESETS = [
  { label: "15 min",  value: "900" },
  { label: "30 min",  value: "1800" },
  { label: "1 hour",  value: "3600" },
  { label: "8 hours", value: "28800" },
  { label: "1 day",   value: "86400" },
  { label: "7 days",  value: "604800" },
  { label: "30 days", value: "2592000" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSeconds(s: number): string {
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminSessionSettingsPage() {
  const [dbValues, setDbValues] = useState<Record<string, string>>({});
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
        const res = await fetch("/api/admin/config", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load");
        const data = (await res.json()) as { data: { key: string; value: string }[] };

        const kv: Record<string, string> = {};
        for (const row of data.data) {
          if (row.key.startsWith("session_ttl_")) {
            kv[row.key] = row.value;
          }
        }
        setDbValues(kv);

        // Initialise local values: use DB value if present, else default
        const init: Record<string, string> = {};
        for (const { key, defaultValue } of SESSION_TTL_KEYS) {
          init[key] = kv[key] ?? String(defaultValue);
        }
        setLocalValues(init);
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
      showToast("Value must be a whole number ≥ 60 seconds", true);
      return;
    }
    setSaving(key);
    try {
      const res = await fetch(`/api/admin/config/${encodeURIComponent(key)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: String(num) }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err?.error?.message ?? "Failed to save");
      }
      setDbValues((prev) => ({ ...prev, [key]: String(num) }));
      showToast("Saved");
    } catch (e) {
      showToast((e as Error).message ?? "Error saving", true);
    } finally {
      setSaving(null);
    }
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
          Configure how long access and refresh tokens stay valid per user role.
          Stored in x_manifest — changes take effect within 60 seconds.
        </p>
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
          <strong>Access token TTL:</strong> time before a silent refresh is triggered automatically.{" "}
          <strong>Refresh token TTL:</strong> how long before the user must sign in again.
        </div>
      </div>

      {ROLE_GROUPS.map(({ role, label }) => {
        const accessMeta = SESSION_TTL_KEYS.find((s) => s.role === role && s.type === "access")!;
        const refreshMeta = SESSION_TTL_KEYS.find((s) => s.role === role && s.type === "refresh")!;

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
                { meta: accessMeta,  fieldLabel: "Access Token TTL" },
                { meta: refreshMeta, fieldLabel: "Refresh Token TTL" },
              ].map(({ meta, fieldLabel }) => {
                const { key, defaultValue } = meta;
                const isOverridden = dbValues[key] !== undefined && dbValues[key] !== String(defaultValue);

                return (
                  <div key={key} className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                          {fieldLabel}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-500">
                          Default: {defaultValue}s ({formatSeconds(defaultValue)})
                          {isOverridden && (
                            <span className="ml-2 text-amber-600 dark:text-amber-400">(overridden)</span>
                          )}
                        </p>
                      </div>
                      <div className="text-right text-xs text-neutral-400">
                        Active:{" "}
                        <span className="font-semibold">
                          {localValues[key]
                            ? `${localValues[key]}s (${formatSeconds(parseInt(localValues[key], 10) || 0)})`
                            : "—"}
                        </span>
                      </div>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setLocalValues((prev) => ({ ...prev, [key]: preset.value }))}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                            localValues[key] === preset.value
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
                        value={localValues[key] ?? ""}
                        onChange={(e) => setLocalValues((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="w-36 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                        placeholder={String(defaultValue)}
                      />
                      <button
                        type="button"
                        onClick={() => void saveSetting(key)}
                        disabled={saving === key}
                        className="rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {saving === key ? "Saving…" : "Save"}
                      </button>
                      {localValues[key] !== String(defaultValue) && (
                        <button
                          type="button"
                          onClick={() => setLocalValues((prev) => ({ ...prev, [key]: String(defaultValue) }))}
                          className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                        >
                          Reset to default
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
