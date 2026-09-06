"use client";

/**
 * app/(admin)/admin/feature-flags/page.tsx
 *
 * Feature flags panel.
 * Lists all feature_* manifest boolean keys with toggle switches.
 * Auto-saves on toggle. Shows last updated timestamp per flag.
 *
 * LABEL_MAP provides human-readable labels and descriptions for every
 * PRD-required feature flag. The API returns raw key/enabled pairs; the
 * page enriches them with metadata from this map before rendering.
 * Unknown keys fall back to a generated label from the key name.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: string;
  availableFrom: string | null;
  earlyAccessPlans: string[] | null;
  modsVisible: boolean;
}

const EARLY_ACCESS_PLAN_OPTIONS = ["plus", "pro", "max"] as const;

// ---------------------------------------------------------------------------
// Label map — human-readable label + description for every feature_* key.
// Covers the original flags and the 11 new PRD flags seeded by migration 008.
// ---------------------------------------------------------------------------

interface FlagMeta {
  label: string;
  description: string;
}

const LABEL_MAP: Record<string, FlagMeta> = {
  // Core platform features (pre-existing)
  feature_rooms: {
    label: "Rooms",
    description: "Enable the live audio/video Rooms feature.",
  },
  feature_direct_messages: {
    label: "Direct Messages",
    description: "Enable one-to-one and group direct messaging.",
  },
  feature_gifts: {
    label: "Virtual Gifts",
    description: "Allow users to send virtual gifts during live rooms.",
  },
  feature_rankings: {
    label: "Rankings & Leaderboards",
    description: "Show weekly and all-time XP leaderboards.",
  },

  // New PRD flags (seeded by migration 008)
  feature_community_notes: {
    label: "Community Notes",
    description:
      "Enable crowdsourced fact-checking notes on posts (similar to X/Twitter Community Notes).",
  },
  feature_star_purchase: {
    label: "Star Currency Purchase",
    description:
      "Allow users to directly purchase Star currency with real money. Disable to use coins-only economy.",
  },
  feature_nemesis_system: {
    label: "Nemesis System",
    description:
      "Enable the Nemesis rival assignment system: users are matched with rivals for weekly challenges.",
  },
  feature_guild_wars: {
    label: "Guild Wars",
    description:
      "Enable the Guild Wars PvP event where guilds compete for XP and prizes.",
  },
  feature_classrooms: {
    label: "ClassRooms",
    description:
      "Enable ClassRoom knowledge rooms where hosts can run structured Q&A sessions.",
  },
  feature_business_accounts: {
    label: "Business Accounts",
    description:
      "Enable Business Account tiers with analytics, branded rooms, and API access.",
  },
  feature_admob_ads: {
    label: "AdMob Ads",
    description: "Show AdMob banner and interstitial ads to free-tier users.",
  },
  feature_rewarded_ads: {
    label: "Rewarded Ads",
    description:
      "Allow free-tier users to watch rewarded ads in exchange for coins.",
  },
  feature_merch_store: {
    label: "Creator Merch Store",
    description:
      "Enable the Creator Merch Store for Elite-tier creators to sell branded merchandise.",
  },
  feature_games: {
    label: "Games",
    description:
      "Master switch for the Games feature: the directory, /g game pages, challenges, wagers and the gaming track.",
  },
  feature_platform_council: {
    label: "Platform Council",
    description:
      "Enable the Platform Council — the top 50 users by Legacy Score get a vote on platform decisions.",
  },
  feature_alliance_system: {
    label: "Guild Alliance System",
    description:
      "Enable Guild Alliances: Platinum+ guilds can form multi-guild alliances for joint wars.",
  },
  feature_pin_auth: {
    label: "PIN Authentication",
    description:
      "Allow users to set a 4-digit PIN as a secondary authentication method.",
  },
  feature_profile_stats: {
    label: "Profile Stats Page",
    description:
      "Enable the User Profile Stats page. Configure which plans get the Basic vs Full view at Admin > Profile Stats.",
  },
};

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
  onSaveAdvanced: (key: string, patch: { mods_visible?: boolean; available_from?: string | null; early_access_plans?: string[] | null }) => Promise<void>;
}

function FlagRow({ flag, onToggle, onSaveAdvanced }: FlagRowProps) {
  const currency = useCurrency();
  const [saving, setSaving] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(flag.enabled);
  const [localUpdatedAt, setLocalUpdatedAt] = useState(flag.updatedAt);
  const [justSaved, setJustSaved] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [modsVisible, setModsVisible] = useState(flag.modsVisible);
  const [earlyAccessPlans, setEarlyAccessPlans] = useState<string[]>(flag.earlyAccessPlans ?? []);
  const [availableFrom, setAvailableFrom] = useState<string>(
    flag.availableFrom ? flag.availableFrom.slice(0, 16) : ""
  );
  const [advancedSaving, setAdvancedSaving] = useState(false);

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

  async function handleModsVisibleToggle(val: boolean) {
    setModsVisible(val);
    setAdvancedSaving(true);
    try {
      await onSaveAdvanced(flag.key, { mods_visible: val });
    } finally {
      setAdvancedSaving(false);
    }
  }

  async function handleSaveEarlyAccess() {
    setAdvancedSaving(true);
    try {
      await onSaveAdvanced(flag.key, {
        available_from: availableFrom ? new Date(availableFrom).toISOString() : null,
        early_access_plans: earlyAccessPlans.length > 0 ? earlyAccessPlans : null,
      });
    } finally {
      setAdvancedSaving(false);
    }
  }

  return (
    <div className="border-b border-neutral-100 py-4 last:border-0 dark:border-neutral-800">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{flag.key}</span>
            {localEnabled ? (
              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">Enabled</span>
            ) : (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Disabled</span>
            )}
            {modsVisible && (
              <span title="Moderators can still see and access this while disabled" className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">Mods can view</span>
            )}
            {justSaved && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">Saved ✓</span>
            )}
          </div>
          <p className="mt-0.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{flag.label}</p>
          <p className="text-xs text-neutral-500">{flag.description.replace(/\bcoins?\b/gi, (m) => m.toLowerCase() === 'coins' ? currency.softPlural.toLowerCase() : currency.softSingular.toLowerCase())}</p>
          {flag.availableFrom && (
            <p className="mt-1 text-xs text-neutral-400">
              <span className="font-medium text-neutral-500">General release:</span>{" "}
              {formatDate(flag.availableFrom)}
            </p>
          )}
          {flag.earlyAccessPlans && flag.earlyAccessPlans.length > 0 && (
            <p className="mt-0.5 text-xs text-neutral-400">
              <span className="font-medium text-neutral-500">Early access plans:</span>{" "}
              {flag.earlyAccessPlans.join(", ")}
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-400">Last updated: {formatDate(localUpdatedAt)}</p>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="mt-1.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {advancedOpen ? "Hide advanced settings ▲" : "Advanced settings ▼"}
          </button>
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

      {advancedOpen && (
        <div className="mt-3 space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Mods can access while disabled</p>
              <p className="text-xs text-neutral-500">
                Moderators still see the nav link (with a disabled marker) and can open the page when this flag is off.
                Leave the flag off and enable this to soft-launch a feature to mods only.
              </p>
            </div>
            <ToggleSwitch
              checked={modsVisible}
              onChange={handleModsVisibleToggle}
              disabled={advancedSaving}
              id={`flag-${flag.key}-mods-visible`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Two-week early access preview</p>
            <p className="mb-2 text-xs text-neutral-500">
              Set a future general-release date and the plans that get early access during the 14 days before it
              (e.g. Max subscribers preview a feature two weeks before everyone else). Leave the date blank to disable scheduling.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                General release date
                <input
                  type="datetime-local"
                  value={availableFrom}
                  onChange={(e) => setAvailableFrom(e.target.value)}
                  className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Early access plans</span>
                <div className="flex flex-wrap gap-1.5">
                  {EARLY_ACCESS_PLAN_OPTIONS.map((plan) => {
                    const active = earlyAccessPlans.includes(plan);
                    return (
                      <button
                        key={plan}
                        type="button"
                        onClick={() =>
                          setEarlyAccessPlans((prev) =>
                            active ? prev.filter((p) => p !== plan) : [...prev, plan]
                          )
                        }
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                          active
                            ? "bg-blue-600 text-white"
                            : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        }`}
                      >
                        {plan}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveEarlyAccess()}
                disabled={advancedSaving}
                className="self-end rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {advancedSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadFlags = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feature-flags", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/gate44/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load flags");

      const body = (await res.json()) as {
        success: boolean;
        items?: Array<{
          key: string;
          enabled: boolean;
          description: string | null;
          updatedAt: string;
          availableFrom: string | null;
          earlyAccessPlans: string[] | null;
          modsVisible: boolean;
        }>;
      };

      const entries = body.items ?? [];

      const enriched: FeatureFlag[] = entries.map((e) => {
        const meta = LABEL_MAP[e.key];
        // Fallback: convert snake_case key to Title Case label
        const fallbackLabel = e.key
          .replace(/^feature_/, "")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return {
          key: e.key,
          label: meta?.label ?? fallbackLabel,
          description: meta?.description ?? e.description ?? "",
          enabled: e.enabled,
          updatedAt: e.updatedAt ?? new Date().toISOString(),
          availableFrom: e.availableFrom ?? null,
          earlyAccessPlans: e.earlyAccessPlans ?? null,
          modsVisible: e.modsVisible ?? false,
        };
      });

      // Sort: LABEL_MAP keys first (known flags), then unknown alphabetically.
      enriched.sort((a, b) => {
        const aKnown = a.key in LABEL_MAP ? 0 : 1;
        const bKnown = b.key in LABEL_MAP ? 0 : 1;
        if (aKnown !== bKnown) return aKnown - bKnown;
        return a.key.localeCompare(b.key);
      });

      setFlags(enriched);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  async function handleToggle(key: string, enabled: boolean) {
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast(`${key} ${enabled ? "enabled" : "disabled"}`);
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Error") : "Error", "error");
      throw e; // let FlagRow revert
    }
  }

  async function handleSaveAdvanced(
    key: string,
    patch: { mods_visible?: boolean; available_from?: string | null; early_access_plans?: string[] | null }
  ) {
    const current = flags.find((f) => f.key === key);
    try {
      const res = await fetch("/api/admin/feature-flags", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled: current?.enabled ?? false, ...patch }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast(`${key} settings saved`);
      await loadFlags();
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Error") : "Error", "error");
      throw e;
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
              <FlagRow key={flag.key} flag={flag} onToggle={handleToggle} onSaveAdvanced={handleSaveAdvanced} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
