"use client";

/**
 * app/(admin)/gate44/moderation/settings/page.tsx
 *
 * Moderation config — reporting rewards, malicious-report Trust Score
 * penalty, duplicate-report flood control, and granular per-action
 * capabilities for Platform Mods (sitewide) and Forum Mods (guild-scoped).
 * A focused view of x_manifest rows, mirrors
 * app/(admin)/gate44/forum/settings/page.tsx. Admin-only.
 */

import { useState, useEffect, useCallback } from "react";

interface FieldMeta {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number";
}

const REWARD_FIELDS: FieldMeta[] = [
  { key: "report_reward_credits_first_accepted", label: "Credits — First Accepted Reporter", description: "Credits awarded to the FIRST reporter of a report that is accepted (any resolution other than dismiss).", type: "number" },
  { key: "report_reward_xp_first_accepted", label: "XP — First Accepted Reporter", description: "XP awarded to the FIRST reporter of an accepted report.", type: "number" },
  { key: "report_reward_xp_subsequent_accepted", label: "XP — Subsequent Accepted Reporters", description: "XP awarded to every reporter after the first on an accepted report (no Credits).", type: "number" },
  { key: "report_reward_xp_not_accepted", label: "XP — Not Accepted (Dismissed)", description: "XP awarded to a reporter when their report is dismissed.", type: "number" },
  { key: "report_malicious_trust_penalty", label: "Malicious Report Trust Penalty", description: "Trust Score points deducted from the original reporter when a moderator marks a report malicious/spammy.", type: "number" },
];

const FLOOD_FIELDS: FieldMeta[] = [
  { key: "report_duplicate_auto_quarantine_threshold", label: "Auto-Quarantine Threshold", description: "Distinct reporters against the same target before it's automatically hidden pending review. 0 disables auto-quarantine.", type: "number" },
  { key: "report_duplicate_cluster_window_hours", label: "Duplicate Cluster Window (Hours)", description: "New reports against the same target within this window are folded into the existing pending report instead of creating a new one.", type: "number" },
];

const PLATFORM_MOD_FIELDS: FieldMeta[] = [
  { key: "modcap_platform_dismiss", label: "Dismiss", description: "Platform Mods may dismiss reports.", type: "boolean" },
  { key: "modcap_platform_warn", label: "Warn", description: "Platform Mods may warn the reported user.", type: "boolean" },
  { key: "modcap_platform_remove_content", label: "Remove Content", description: "Platform Mods may remove reported content.", type: "boolean" },
  { key: "modcap_platform_suspend_user", label: "Suspend User", description: "Platform Mods may temporarily suspend the reported user.", type: "boolean" },
  { key: "modcap_platform_ban_user", label: "Ban User", description: "Platform Mods may permanently ban the reported user.", type: "boolean" },
  { key: "modcap_platform_escalate_ai", label: "Escalate to AI", description: "Platform Mods may trigger a paid AI re-escalation (costs an API call).", type: "boolean" },
];

const GUILD_MOD_FIELDS: FieldMeta[] = [
  { key: "modcap_guild_dismiss", label: "Dismiss", description: "Forum Mods may dismiss reports scoped to their guild.", type: "boolean" },
  { key: "modcap_guild_warn", label: "Warn", description: "Forum Mods may warn a guild member.", type: "boolean" },
  { key: "modcap_guild_remove_content", label: "Remove Content", description: "Forum Mods may remove a reported guild chat message.", type: "boolean" },
  { key: "modcap_guild_mute_member", label: "Mute Member", description: "Forum Mods may temporarily mute a guild member from guild chat.", type: "boolean" },
  { key: "modcap_guild_kick_member", label: "Kick Member", description: "Forum Mods may remove a member from the guild.", type: "boolean" },
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

function FieldGroup({
  title,
  description,
  fields,
  values,
  saving,
  onSave,
}: {
  title: string;
  description?: string;
  fields: FieldMeta[];
  values: Record<string, string>;
  saving: string | null;
  onSave: (key: string, value: string) => void;
}) {
  return (
    <div className="mb-6">
      <h2 className="mb-1 text-sm font-bold text-neutral-900 dark:text-neutral-50">{title}</h2>
      {description && <p className="mb-2 text-xs text-neutral-500">{description}</p>}
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {fields.map((field) => {
          const raw = values[field.key] ?? "";
          const isSaving = saving === field.key;
          return (
            <div key={field.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{field.label}</p>
                <p className="text-xs text-neutral-500">{field.description}</p>
              </div>
              {field.type === "boolean" ? (
                <ToggleSwitch checked={raw === "true"} disabled={isSaving} onChange={(v) => onSave(field.key, v ? "true" : "false")} />
              ) : (
                <input
                  type="number"
                  defaultValue={raw}
                  disabled={isSaving}
                  onBlur={(e) => { if (e.target.value !== raw) onSave(field.key, e.target.value); }}
                  className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminModerationSettingsPage() {
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
        <p className="mt-1 text-sm text-neutral-500">Only administrators can change moderation settings. Moderators can still use the Moderation Center at /watch56.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Moderation Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Reporting rewards, malicious-report penalty, duplicate-report flood control, and granular capabilities for Platform
        Mods (sitewide) and Forum Mods (guild-scoped, assigned by a guild&apos;s captain). Admins can always perform every
        action regardless of these flags. Also editable at /gate44/config.
      </p>

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
        <>
          <FieldGroup title="Reporting Rewards" fields={REWARD_FIELDS} values={values} saving={saving} onSave={save} />
          <FieldGroup title="Flood Control" description="Handles hundreds of similar/identical reports against one piece of content without flooding the moderation queue." fields={FLOOD_FIELDS} values={values} saving={saving} onSave={save} />
          <FieldGroup title="Platform Mod Capabilities" description="Sitewide moderators (users.is_moderator)." fields={PLATFORM_MOD_FIELDS} values={values} saving={saving} onSave={save} />
          <FieldGroup title="Forum Mod Capabilities" description="Guild-scoped moderators, assigned by the guild captain. No sitewide jurisdiction." fields={GUILD_MOD_FIELDS} values={values} saving={saving} onSave={save} />
        </>
      )}
    </div>
  );
}
