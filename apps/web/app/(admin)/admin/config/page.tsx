"use client";

/**
 * app/(admin)/admin/config/page.tsx
 *
 * Platform configuration page for admin panel.
 * Grouped settings with inline editing, toggle switches for booleans,
 * select dropdowns for enum fields, and per-key save via PUT /api/admin/config/[key].
 *
 * Groups covered:
 *   Auth       - Google OAuth, Telegram login
 *   CAPTCHA    - provider selector (recaptcha / turnstile / none)
 *   GIF        - provider selector (giphy / tenor)
 *   PWA        - web / android / ios toggles
 *   Payments   - primary provider, paystack, dodopayments
 *   Economy    - coin-to-cash rate, payout thresholds, season pass, VIP room prices
 *   Limits     - minimum age
 *   AdMob      - admob ads, rewarded ads
 *   Miscellaneous - deep link base URL, and any unknown keys
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConfigValueType = "boolean" | "string" | "number" | "select";

interface SelectOption {
  value: string;
  label: string;
}

interface ConfigMeta {
  label: string;
  description: string;
  type: ConfigValueType;
  group: string;
  options?: SelectOption[]; // for type === "select"
}

interface ConfigItem {
  key: string;
  label: string;
  description: string;
  value: boolean | string | number;
  type: ConfigValueType;
  group: string;
  options?: SelectOption[];
}

type GroupedConfig = Record<string, ConfigItem[]>;

// ---------------------------------------------------------------------------
// Metadata map — defines label, description, type, group (and options) for
// every x_manifest key that should appear in the config panel.
// Keys not listed here are shown in "Miscellaneous" with a generic string type.
// ---------------------------------------------------------------------------

const CONFIG_META: Record<string, ConfigMeta> = {
  // Auth
  auth_google_enabled: {
    label: "Google OAuth",
    description: "Allow users to sign in with their Google account.",
    type: "boolean",
    group: "Auth",
  },
  auth_telegram_enabled: {
    label: "Telegram Login",
    description: "Allow users to sign in via Telegram Login widget.",
    type: "boolean",
    group: "Auth",
  },
  auth_2fa_enabled: {
    label: "Two-Factor Authentication (2FA)",
    description: "Allow users to enable TOTP-based 2FA on their accounts.",
    type: "boolean",
    group: "Auth",
  },
  auth_2fa_required_for_mods: {
    label: "Require 2FA for Moderators",
    description: "Block moderator logins until they set up 2FA on their account.",
    type: "boolean",
    group: "Auth",
  },
  feature_pin_auth: {
    label: "PIN Authentication",
    description: "Allow users to set a numeric PIN for quick app unlock.",
    type: "boolean",
    group: "Auth",
  },

  // CAPTCHA
  captcha_provider: {
    label: "CAPTCHA Provider",
    description:
      "CAPTCHA service used on registration, login, and sensitive forms.",
    type: "select",
    group: "CAPTCHA",
    options: [
      { value: "recaptcha", label: "Google reCAPTCHA v3" },
      { value: "turnstile", label: "Cloudflare Turnstile" },
      { value: "none", label: "None (disable CAPTCHA)" },
    ],
  },

  // GIF
  gif_provider: {
    label: "GIF Search Provider",
    description: "Third-party service used to power the GIF picker in chat.",
    type: "select",
    group: "GIF",
    options: [
      { value: "giphy", label: "Giphy" },
      { value: "tenor", label: "Tenor (Google)" },
    ],
  },

  // PWA
  pwa_web_enabled: {
    label: "PWA — Web Browser",
    description: "Enable Progressive Web App install prompt in desktop/mobile browsers.",
    type: "boolean",
    group: "PWA",
  },
  pwa_android_enabled: {
    label: "PWA — Android",
    description: "Enable PWA install for Android home screen.",
    type: "boolean",
    group: "PWA",
  },
  pwa_ios_enabled: {
    label: "PWA — iOS",
    description: "Enable PWA install for iOS home screen (Safari Add to Home Screen).",
    type: "boolean",
    group: "PWA",
  },

  // Payments
  payment_primary_provider: {
    label: "Primary Payment Provider",
    description: "The default gateway used for deposits and payouts.",
    type: "select",
    group: "Payments",
    options: [
      { value: "paystack", label: "Paystack" },
      { value: "dodopayments", label: "Dodo Payments" },
      { value: "none", label: "None (payments disabled)" },
    ],
  },
  payment_paystack_enabled: {
    label: "Paystack Enabled",
    description: "Allow Paystack as a payment method.",
    type: "boolean",
    group: "Payments",
  },
  payment_dodopayments_enabled: {
    label: "Dodo Payments Enabled",
    description: "Allow Dodo Payments as a payment method.",
    type: "boolean",
    group: "Payments",
  },

  // Economy
  currency_soft_name_singular: {
    label: "Soft Currency Name (Singular)",
    description: "Display name for one unit of the soft (earned) currency. Default: Credit",
    type: "string",
    group: "Economy",
  },
  currency_soft_name_plural: {
    label: "Soft Currency Name (Plural)",
    description: "Display name for multiple units of the soft (earned) currency. Default: Credits",
    type: "string",
    group: "Economy",
  },
  currency_premium_name_singular: {
    label: "Premium Currency Name (Singular)",
    description: "Display name for one unit of the premium (purchased) currency. Default: Star",
    type: "string",
    group: "Economy",
  },
  currency_premium_name_plural: {
    label: "Premium Currency Name (Plural)",
    description: "Display name for multiple units of the premium (purchased) currency. Default: Stars",
    type: "string",
    group: "Economy",
  },
  coin_to_cash_rate: {
    label: "Credit-to-Cash Rate",
    description: "Number of Credits equivalent to ₦1 (e.g. 100 means 100 Credits = ₦1).",
    type: "number",
    group: "Economy",
  },
  payout_threshold_kobo: {
    label: "Minimum Payout (kobo)",
    description: "Minimum creator payout amount in kobo. 100 kobo = ₦1.",
    type: "number",
    group: "Economy",
  },
  payout_large_approval_kobo: {
    label: "Large Payout Approval Threshold (kobo)",
    description:
      "Withdrawals above this kobo amount require manual admin approval.",
    type: "number",
    group: "Economy",
  },
  season_pass_price_coins: {
    label: "Season Pass Price (Credits)",
    description: "Default price of a Season Pass in Credits.",
    type: "number",
    group: "Economy",
  },
  vip_room_min_price_kobo: {
    label: "VIP Room Min Price (kobo)",
    description: "Minimum subscription price a creator can set for a VIP Room.",
    type: "number",
    group: "Economy",
  },
  vip_room_max_price_kobo: {
    label: "VIP Room Max Price (kobo)",
    description: "Maximum subscription price a creator can set for a VIP Room.",
    type: "number",
    group: "Economy",
  },

  // Fraud Detection
  fraud_gift_window_days: {
    label: "Gift Fraud Window (days)",
    description: "Look-back window for new-account gift-inflow fraud check. Default: 7.",
    type: "number",
    group: "Fraud Detection",
  },
  fraud_inflow_threshold_coins: {
    label: "Gift Inflow Threshold (coins)",
    description: "Minimum coins received from new accounts within the fraud window to trigger a flag. Default: 5000.",
    type: "number",
    group: "Fraud Detection",
  },
  fraud_new_account_age_days: {
    label: "New Account Age (days)",
    description: "Age (days) below which a gift sender is treated as a 'new account' for fraud purposes. Default: 7.",
    type: "number",
    group: "Fraud Detection",
  },
  fraud_max_payouts_per_day: {
    label: "Max Payout Requests per Day",
    description: "Maximum payout requests per creator per 24 h before a velocity fraud flag fires. Default: 3.",
    type: "number",
    group: "Fraud Detection",
  },

  // Limits
  minimum_age: {
    label: "Minimum Registration Age",
    description: "Minimum age (in years) required to create an account.",
    type: "number",
    group: "Limits",
  },

  // AdMob
  feature_admob_ads: {
    label: "AdMob Ads",
    description: "Show AdMob banner/interstitial ads to free-tier users.",
    type: "boolean",
    group: "AdMob",
  },
  feature_rewarded_ads: {
    label: "Rewarded Ads",
    description: "Allow free-tier users to earn Credits by watching rewarded ads.",
    type: "boolean",
    group: "AdMob",
  },

  // AI Moderation
  ai_moderation_auto_action_threshold: {
    label: "Auto-Action Threshold",
    description:
      "Confidence score (0.0–1.0) above which the AI automatically removes content / suspends users. Default: 0.9",
    type: "number",
    group: "AI Moderation",
  },
  ai_moderation_community_threshold: {
    label: "Community Review Threshold",
    description:
      "Confidence score (0.0–1.0) above which a report is sent to Community Notes for crowd review. Below this = manual queue. Default: 0.7",
    type: "number",
    group: "AI Moderation",
  },
  ai_moderation_system_prompt: {
    label: "AI System Prompt Override",
    description:
      "Custom system prompt for AI classification. Leave empty to use the built-in default prompt.",
    type: "string",
    group: "AI Moderation",
  },

  // Guild Wars
  feature_war_event_active: {
    label: "Platform War Event Active",
    description: "Activates a platform-wide War Event. Reduces war cooldown to the configured hours below.",
    type: "boolean",
    group: "Guild Wars",
  },
  war_event_cooldown_hours: {
    label: "War Event Cooldown (hours)",
    description: "Guild war cooldown during an active War Event. Default is 48. Normal cooldown is 72 hours.",
    type: "number",
    group: "Guild Wars",
  },

  // Messaging
  feature_pidgin_autocomplete: {
    label: "Pidgin Autocomplete",
    description: "When enabled, users can turn on Pidgin word suggestions in the message composer.",
    type: "boolean",
    group: "Messaging",
  },
  announcement_modal_display_mode: {
    label: "Announcement Modal Display Mode",
    description: "How modals are rotated per user: 'serial' shows them in order, 'random' picks randomly.",
    type: "select",
    group: "Messaging",
    options: [
      { value: "serial", label: "Serial (in order)" },
      { value: "random", label: "Random" },
    ],
  },
  announcement_banner_mode: {
    label: "Announcement Banner Display Mode",
    description: "How banners are rotated per user: 'serial' shows them in order, 'random' picks randomly.",
    type: "select",
    group: "Messaging",
    options: [
      { value: "serial", label: "Serial (in order)" },
      { value: "random", label: "Random" },
    ],
  },

  // Physical Goods
  physical_goods_enabled: {
    label: "Allow Physical Product Sales",
    description: "Master toggle — enables physical goods in creator merch stores.",
    type: "boolean",
    group: "Physical Goods",
  },
  physical_goods_fulfillment_manual: {
    label: "Manual Fulfillment",
    description: "Allow creators to fulfill physical orders manually (ship-it-yourself with optional tracking).",
    type: "boolean",
    group: "Physical Goods",
  },
  physical_goods_fulfillment_partner: {
    label: "Partner Integration (Coming Soon)",
    description: "Enable the partner fulfillment option. UI shows 'Coming Soon' — only manual fulfillment is processed.",
    type: "boolean",
    group: "Physical Goods",
  },

  // Floating Notifications
  floating_notifications_enabled: {
    label: "Enable Floating Notifications",
    description: "Show floating reward notifications (+5 XP, +25 Credits, etc.) when users earn currency. Applies to all platforms.",
    type: "boolean",
    group: "Floating Notifications",
  },
  floating_notifications_xp_threshold: {
    label: "XP Confetti Threshold",
    description: "Single XP award must reach this amount to also trigger a confetti celebration. Default: 100.",
    type: "number",
    group: "Floating Notifications",
  },
  floating_notifications_credits_threshold: {
    label: "Credits Confetti Threshold",
    description: "Single Credit award must reach this amount to also trigger a confetti celebration. Default: 50.",
    type: "number",
    group: "Floating Notifications",
  },
  floating_notifications_stars_threshold: {
    label: "Stars Confetti Threshold",
    description: "Single Star award must reach this amount to also trigger a confetti celebration. Default: 10.",
    type: "number",
    group: "Floating Notifications",
  },

  // Miscellaneous
  deep_link_base_url: {
    label: "Deep Link Base URL",
    description: "Base URL used when generating deep links (e.g. https://zobia.app).",
    type: "string",
    group: "Miscellaneous",
  },
};

// Groups that should be shown even if they have no items, and in what order.
const GROUP_ORDER = [
  "Auth",
  "CAPTCHA",
  "GIF",
  "PWA",
  "Floating Notifications",
  "Payments",
  "Economy",
  "Fraud Detection",
  "AdMob",
  "Limits",
  "AI Moderation",
  "Guild Wars",
  "Messaging",
  "Physical Goods",
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
// Config row — supports boolean toggle, select dropdown, and inline text/number edit
// ---------------------------------------------------------------------------

interface ConfigRowProps {
  item: ConfigItem;
  onSave: (key: string, value: boolean | string | number) => Promise<void>;
}

function ConfigRow({ item, onSave }: ConfigRowProps) {
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

  async function handleSelectChange(val: string) {
    setSaving(true);
    await onSave(item.key, val);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-wrap items-start gap-4 border-b border-neutral-100 py-4 last:border-0 dark:border-neutral-800">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
            {item.key}
          </span>
          {saved && (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
              Saved ✓
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {item.label}
        </p>
        <p className="text-xs text-neutral-500">{item.description}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {item.type === "boolean" ? (
          <ToggleSwitch
            checked={item.value as boolean}
            onChange={handleToggle}
            disabled={saving}
          />
        ) : item.type === "select" ? (
          <select
            value={String(item.value)}
            onChange={(e) => handleSelectChange(e.target.value)}
            disabled={saving}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            {item.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
              onClick={() => {
                setEditing(false);
                setLocalValue(String(item.value));
              }}
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
// Helpers
// ---------------------------------------------------------------------------

/** Raw row returned by GET /api/admin/config */
interface RawManifestEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

/**
 * Convert a raw x_manifest row into a typed ConfigItem using CONFIG_META for
 * label/description/type/group, falling back to sensible defaults for unknown keys.
 */
function toConfigItem(entry: RawManifestEntry): ConfigItem {
  const meta = CONFIG_META[entry.key];

  // Skip pure feature_* keys — they are managed by the Feature Flags panel,
  // EXCEPT admob/rewarded which live in the AdMob group above.
  if (
    entry.key.startsWith("feature_") &&
    entry.key !== "feature_admob_ads" &&
    entry.key !== "feature_rewarded_ads"
  ) {
    return null as unknown as ConfigItem; // filtered out below
  }

  if (meta) {
    let parsedValue: boolean | string | number;
    if (meta.type === "boolean") {
      parsedValue = entry.value === "true";
    } else if (meta.type === "number") {
      parsedValue = parseInt(entry.value, 10) || 0;
    } else {
      // string or select
      parsedValue = entry.value;
    }
    return {
      key: entry.key,
      label: meta.label,
      description: meta.description,
      value: parsedValue,
      type: meta.type,
      group: meta.group,
      options: meta.options,
    };
  }

  // Fallback for unknown keys — show as editable string in Miscellaneous
  return {
    key: entry.key,
    label: entry.key,
    description: entry.description ?? "",
    value: entry.value,
    type: "string",
    group: "Miscellaneous",
  };
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin platform configuration page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminConfigPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [grouped, setGrouped] = useState<GroupedConfig>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(GROUP_ORDER.map((g) => [g, true]))
  );

  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      setToast({ msg, type });
      setTimeout(() => setToast(null), 3500);
    },
    []
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/config", { credentials: "include" });
        if (res.status === 401 || res.status === 403) {
          window.location.href = "/admin/login";
          return;
        }
        if (!res.ok) throw new Error("Failed to load config");

        // The API returns { success, data: RawManifestEntry[], error }
        const body = (await res.json()) as {
          success: boolean;
          data?: RawManifestEntry[];
          // legacy shape support
          config?: RawManifestEntry[];
        };

        const rawEntries: RawManifestEntry[] = body.data ?? body.config ?? [];

        const items: ConfigItem[] = rawEntries
          .map(toConfigItem)
          .filter(Boolean);

        const g: GroupedConfig = {};
        for (const item of items) {
          const group = item.group || "Miscellaneous";
          if (!g[group]) g[group] = [];
          g[group].push(item);
        }
        setGrouped(g);
      } catch (e) {
        setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(key: string, value: boolean | string | number) {
    try {
      // The API expects string values
      const stringValue =
        typeof value === "boolean" ? String(value) : String(value);

      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: stringValue }),
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
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Save failed") : "Save failed", "error");
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
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Platform Configuration
      </h1>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}
        >
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            >
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
          <div
            key={group}
            className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900"
          >
            <button
              onClick={() => toggleGroup(group)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div>
                <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {group}
                </h2>
                <p className="text-xs text-neutral-500">
                  {grouped[group]?.length ?? 0} settings
                </p>
              </div>
              <span className="text-neutral-400">
                {openGroups[group] ? "▲" : "▼"}
              </span>
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
