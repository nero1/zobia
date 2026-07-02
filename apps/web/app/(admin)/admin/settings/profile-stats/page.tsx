"use client";

/**
 * app/(admin)/admin/settings/profile-stats/page.tsx
 *
 * Admin panel — User Profile Stats page settings.
 *
 * The master on/off switch for the Stats page lives on the generic
 * Feature Flags panel (key: feature_profile_stats, matches the `feature_%`
 * prefix so it's picked up automatically). This page only configures which
 * plans/prestige tiers get the "Full" stats view (detailed leaderboard
 * positions + season history) — everyone else gets the "Basic" view.
 * Stored in x_manifest and read back via GET /api/admin/config.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PLAN_OPTIONS = ["free", "plus", "pro", "max"] as const;
const PRESTIGE_OPTIONS = ["prestige_1", "prestige_2", "prestige_5", "prestige_10"] as const;

type PlanOption = (typeof PLAN_OPTIONS)[number];
type PrestigeOption = (typeof PRESTIGE_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonList<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T[]; } catch { return fallback; }
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// ---------------------------------------------------------------------------
// Toggle chip
// ---------------------------------------------------------------------------

function Chip<T extends string>({
  value,
  active,
  onToggle,
  label,
}: {
  value: T;
  active: boolean;
  onToggle: (v: T) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(value)}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "border border-neutral-300 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
      }`}
    >
      {label ?? value}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminProfileStatsSettingsPage() {
  const [fullPlans, setFullPlans] = useState<(PlanOption | PrestigeOption)[]>(["plus", "pro", "max"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/config", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { data?: { key: string; value: string }[] };
        const entries = data.data ?? [];
        const get = (key: string) => entries.find((e) => e.key === key)?.value;
        setFullPlans(parseJsonList(get("profile_stats_full_plans"), ["plus", "pro", "max"]));
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/config/profile_stats_full_plans", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(fullPlans) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast("Saved");
    } catch {
      showToast("Error saving — please try again");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="h-32 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Profile Stats Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Control which plans and prestige ranks get the Full Stats view. Everyone else sees the Basic
          Stats view. The master on/off switch for the Stats page lives on{" "}
          <Link href="/admin/feature-flags" className="text-blue-600 hover:underline dark:text-blue-400">
            Feature Flags
          </Link>{" "}
          (key: <code className="font-mono text-xs">feature_profile_stats</code>). Changes take effect
          within 60 seconds.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Who gets the Full Stats view</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Users on these plans/ranks see detailed leaderboard positions (every track, every scope) and
            season history on their Stats page. Everyone else sees the Basic view: badges, levels,
            achievements, created rooms, and social counts only.
          </p>
        </div>
        <div className="p-5">
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Plans</p>
            <div className="flex flex-wrap gap-2">
              {PLAN_OPTIONS.map((plan) => (
                <Chip
                  key={plan}
                  value={plan}
                  active={fullPlans.includes(plan)}
                  onToggle={(v) => setFullPlans((prev) => toggleInList(prev, v as PlanOption))}
                  label={plan.charAt(0).toUpperCase() + plan.slice(1)}
                />
              ))}
            </div>
          </div>
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Prestige Ranks</p>
            <div className="flex flex-wrap gap-2">
              {PRESTIGE_OPTIONS.map((p) => (
                <Chip
                  key={p}
                  value={p}
                  active={fullPlans.includes(p)}
                  onToggle={(v) => setFullPlans((prev) => toggleInList(prev, v as PrestigeOption))}
                  label={p.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                />
              ))}
            </div>
          </div>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
