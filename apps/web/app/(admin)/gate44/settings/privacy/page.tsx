"use client";

/**
 * app/(admin)/admin/settings/privacy/page.tsx
 *
 * Admin panel — Profile Privacy feature flag controls.
 *
 * Admins can configure which plans/roles/ranks are allowed to use each
 * privacy feature. Settings are stored in x_manifest and read back via
 * GET /api/admin/config.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PLAN_OPTIONS = ["free", "plus", "pro", "max"] as const;
const PRESTIGE_OPTIONS = ["prestige_1", "prestige_2", "prestige_5", "prestige_10"] as const;
const ALL_SECTIONS = ["avatar", "bio", "rank", "xp", "guild", "seasons", "badges"] as const;

type PlanOption = (typeof PLAN_OPTIONS)[number];
type PrestigeOption = (typeof PRESTIGE_OPTIONS)[number];
type SectionKey = (typeof ALL_SECTIONS)[number];

interface PrivacyConfig {
  canLockProfile: (PlanOption | PrestigeOption)[];
  canHideSections: (PlanOption | PrestigeOption)[];
  canDisableFriendRequests: (PlanOption | PrestigeOption)[];
  hideableSections: SectionKey[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonList<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T[]; } catch { return fallback; }
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
// Toggle group helper
// ---------------------------------------------------------------------------

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminPrivacySettingsPage() {
  const [config, setConfig] = useState<PrivacyConfig>({
    canLockProfile: ["pro", "max", "prestige_1"],
    canHideSections: ["plus", "pro", "max", "prestige_1"],
    canDisableFriendRequests: ["plus", "pro", "max", "prestige_1"],
    hideableSections: [...ALL_SECTIONS],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
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
        setConfig({
          canLockProfile: parseJsonList(get("privacy_can_lock_profile"), ["pro", "max", "prestige_1"]),
          canHideSections: parseJsonList(get("privacy_can_hide_sections"), ["plus", "pro", "max", "prestige_1"]),
          canDisableFriendRequests: parseJsonList(get("privacy_can_disable_friend_requests"), ["plus", "pro", "max", "prestige_1"]),
          hideableSections: parseJsonList(get("privacy_hideable_sections"), [...ALL_SECTIONS]),
        });
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    })();
  }, []);

  async function saveKey(key: string, value: unknown) {
    setSaving(key);
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(value) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast("Saved");
    } catch {
      showToast("Error saving — please try again");
    } finally {
      setSaving(null);
    }
  }

  function updateList<K extends keyof PrivacyConfig>(
    field: K,
    value: PrivacyConfig[K][number]
  ) {
    setConfig((prev) => ({
      ...prev,
      [field]: toggleInList(prev[field] as string[], value as string),
    }));
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
        ))}
      </div>
    );
  }

  const settingBlocks: {
    key: keyof PrivacyConfig;
    apiKey: string;
    title: string;
    description: string;
    options: (PlanOption | PrestigeOption)[];
  }[] = [
    {
      key: "canLockProfile",
      apiKey: "privacy_can_lock_profile",
      title: "Who can lock (privatise) their profile",
      description: "Users on these plans/ranks can hide their profile from non-friends.",
      options: [...PLAN_OPTIONS, ...PRESTIGE_OPTIONS],
    },
    {
      key: "canHideSections",
      apiKey: "privacy_can_hide_sections",
      title: "Who can hide profile sections",
      description: "Users on these plans/ranks can individually hide sections of their profile.",
      options: [...PLAN_OPTIONS, ...PRESTIGE_OPTIONS],
    },
    {
      key: "canDisableFriendRequests",
      apiKey: "privacy_can_disable_friend_requests",
      title: "Who can disable friend requests",
      description: "Users on these plans/ranks can prevent others from sending them friend requests.",
      options: [...PLAN_OPTIONS, ...PRESTIGE_OPTIONS],
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Profile Privacy Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Control which plans and ranks can access each privacy feature.
          Changes take effect within 60 seconds.
        </p>
      </div>

      {settingBlocks.map((block) => (
        <div key={block.key} className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{block.title}</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{block.description}</p>
          </div>
          <div className="p-5">
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Plans</p>
              <div className="flex flex-wrap gap-2">
                {PLAN_OPTIONS.map((plan) => (
                  <Chip
                    key={plan}
                    value={plan}
                    active={(config[block.key] as string[]).includes(plan)}
                    onToggle={(v) => updateList(block.key, v as PlanOption)}
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
                    active={(config[block.key] as string[]).includes(p)}
                    onToggle={(v) => updateList(block.key, v as PrestigeOption)}
                    label={p.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={() => void saveKey(block.apiKey, config[block.key])}
              disabled={saving === block.apiKey}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving === block.apiKey ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ))}

      {/* Hideable sections */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Available sections to hide</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Choose which profile sections users are allowed to hide. Unchecked sections will always be visible.
          </p>
        </div>
        <div className="p-5">
          <div className="mb-5 flex flex-wrap gap-2">
            {ALL_SECTIONS.map((section) => (
              <Chip
                key={section}
                value={section}
                active={config.hideableSections.includes(section)}
                onToggle={(v) => updateList("hideableSections", v as SectionKey)}
                label={section.charAt(0).toUpperCase() + section.slice(1)}
              />
            ))}
          </div>
          <button
            onClick={() => void saveKey("privacy_hideable_sections", config.hideableSections)}
            disabled={saving === "privacy_hideable_sections"}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving === "privacy_hideable_sections" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
