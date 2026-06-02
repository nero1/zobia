"use client";

/**
 * app/(admin)/admin/feature-flags/page.tsx
 *
 * Feature flags panel.
 * Lists all feature_* manifest boolean keys with toggle switches.
 * Auto-saves on toggle. Shows last updated timestamp per flag.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
  id?: string;
}

function ToggleSwitch({ checked, onChange, disabled, id }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-blue-600" : "bg-neutral-300 dark:bg-neutral-600"}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-card transition duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Flag row
// ---------------------------------------------------------------------------

interface FlagRowProps {
  flag: FeatureFlag;
  onToggle: (key: string, enabled: boolean) => Promise<void>;
}

function FlagRow({ flag, onToggle }: FlagRowProps) {
  const [saving, setSaving] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(flag.enabled);
  const [localUpdatedAt, setLocalUpdatedAt] = useState(flag.updatedAt);
  const [justSaved, setJustSaved] = useState(false);

  async function handleToggle(val: boolean) {
    setSaving(true);
    try {
      await onToggle(flag.key, val);
      setLocalEnabled(val);
      setLocalUpdatedAt(new Date().toISOString());
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-4 border-b border-neutral-100 py-4 last:border-0 dark:border-neutral-800">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{flag.key}</span>
          {localEnabled ? (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">Enabled</span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Disabled</span>
          )}
          {justSaved && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">Saved ✓</span>
          )}
        </div>
        <p className="mt-0.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{flag.label}</p>
        <p className="text-xs text-neutral-500">{flag.description}</p>
        <p className="mt-1 text-xs text-neutral-400">Last updated: {formatDate(localUpdatedAt)}</p>
      </div>
      <div className="mt-0.5 shrink-0">
        <ToggleSwitch
          checked={localEnabled}
          onChange={handleToggle}
          disabled={saving}
          id={`flag-${flag.key}`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin feature flags panel.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminFeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/feature-flags", { credentials: "include" });
        if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
        if (!res.ok) throw new Error("Failed to load flags");
        const data = (await res.json()) as { flags: FeatureFlag[] };
        setFlags(data.flags);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleToggle(key: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: enabled }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast(`${key} ${enabled ? "enabled" : "disabled"}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
      throw e; // let FlagRow revert
    }
  }

  const filtered = flags.filter(
    (f) =>
      search === "" ||
      f.key.toLowerCase().includes(search.toLowerCase()) ||
      f.label.toLowerCase().includes(search.toLowerCase())
  );

  const enabledCount = flags.filter((f) => f.enabled).length;

  return (
    <div className="relative space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Feature Flags</h1>
          {!loading && (
            <p className="text-sm text-neutral-500">
              {enabledCount} of {flags.length} enabled
            </p>
          )}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter flags…"
          className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
        />
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        {loading ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-4">
                <div className="space-y-2">
                  <div className="h-3 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="h-4 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="h-3 w-64 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                </div>
                <div className="h-6 w-11 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-neutral-500">No flags found</p>
        ) : (
          <div className="px-5">
            {filtered.map((flag) => (
              <FlagRow key={flag.key} flag={flag} onToggle={handleToggle} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
