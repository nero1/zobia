"use client";

/**
 * app/(admin)/gate44/wiki/settings/page.tsx
 *
 * Wiki config — a focused view of the same x_manifest rows also editable
 * at /gate44/config under the "x_manifest" search. Both surfaces write the
 * same rows via PUT /api/admin/config/[key] and call invalidateManifestCache()
 * server-side, so edits here and at /gate44/config are immediately
 * consistent. Mirrors gate44/quizzes/settings/page.tsx.
 *
 * Admin-only — the underlying config write endpoint is admin-only.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

type FieldType = "boolean" | "number" | "plan";

interface FieldMeta {
  key: string;
  labelKey: string;
  labelDefault: string;
  descriptionKey: string;
  descriptionDefault: string;
  type: FieldType;
}

const PLAN_OPTIONS = ["free", "plus", "pro", "max"] as const;

const FIELDS: FieldMeta[] = [
  { key: "feature_wiki", labelKey: "admin.wiki.settings.field.featureWiki.label", labelDefault: "Enable Wiki", descriptionKey: "admin.wiki.settings.field.featureWiki.description", descriptionDefault: "Master toggle. When off, all /api/wiki endpoints and /w/* pages are unavailable.", type: "boolean" },
  { key: "wiki_monetization_enabled", labelKey: "admin.wiki.settings.field.monetizationEnabled.label", labelDefault: "Enable Wiki Reward Pots", descriptionKey: "admin.wiki.settings.field.monetizationEnabled.description", descriptionDefault: "Master kill-switch for Wiki treasuries (reward pots). When off, funding/claiming a pot is disabled but wikis still work.", type: "boolean" },
  { key: "wiki_create_required_plan", labelKey: "admin.wiki.settings.field.createRequiredPlan.label", labelDefault: "Minimum Plan to Create", descriptionKey: "admin.wiki.settings.field.createRequiredPlan.description", descriptionDefault: "Minimum plan required to create a wiki.", type: "plan" },
  { key: "wiki_create_min_level", labelKey: "admin.wiki.settings.field.createMinLevel.label", labelDefault: "Minimum Creator Level to Create", descriptionKey: "admin.wiki.settings.field.createMinLevel.description", descriptionDefault: "Minimum creator level required to create a wiki.", type: "number" },
  { key: "wiki_create_restricted_to_staff", labelKey: "admin.wiki.settings.field.createRestrictedToStaff.label", labelDefault: "Restrict Creation to Staff", descriptionKey: "admin.wiki.settings.field.createRestrictedToStaff.description", descriptionDefault: "When on, only moderators/admins may create wikis, regardless of plan/level.", type: "boolean" },
  { key: "wiki_create_reward_xp", labelKey: "admin.wiki.settings.field.createRewardXp.label", labelDefault: "XP for Creating a Wiki", descriptionKey: "admin.wiki.settings.field.createRewardXp.description", descriptionDefault: "XP awarded to a user for creating a wiki.", type: "number" },
  { key: "wiki_create_reward_credits", labelKey: "admin.wiki.settings.field.createRewardCredits.label", labelDefault: "Credits for Creating a Wiki", descriptionKey: "admin.wiki.settings.field.createRewardCredits.description", descriptionDefault: "Credits awarded to a user for creating a wiki.", type: "number" },
  { key: "wiki_contribute_reward_xp", labelKey: "admin.wiki.settings.field.contributeRewardXp.label", labelDefault: "XP for Contributing a Page", descriptionKey: "admin.wiki.settings.field.contributeRewardXp.description", descriptionDefault: "XP awarded to a user for creating or editing a wiki page.", type: "number" },
  { key: "wiki_contribute_reward_credits", labelKey: "admin.wiki.settings.field.contributeRewardCredits.label", labelDefault: "Credits for Contributing a Page", descriptionKey: "admin.wiki.settings.field.contributeRewardCredits.description", descriptionDefault: "Credits awarded to a user for creating or editing a wiki page.", type: "number" },
  { key: "wiki_daily_reward_cap_credits", labelKey: "admin.wiki.settings.field.dailyRewardCapCredits.label", labelDefault: "Daily Reward Cap (Credits)", descriptionKey: "admin.wiki.settings.field.dailyRewardCapCredits.description", descriptionDefault: "Ceiling on total wiki-sourced credit rewards a user can earn per rolling 24h.", type: "number" },
  { key: "wiki_max_owned_free", labelKey: "admin.wiki.settings.field.maxOwnedFree.label", labelDefault: "Max Owned Wikis — Free", descriptionKey: "admin.wiki.settings.field.maxOwnedFree.description", descriptionDefault: "Max wikis a Free-plan user may own.", type: "number" },
  { key: "wiki_max_owned_plus", labelKey: "admin.wiki.settings.field.maxOwnedPlus.label", labelDefault: "Max Owned Wikis — Plus", descriptionKey: "admin.wiki.settings.field.maxOwnedPlus.description", descriptionDefault: "Max wikis a Plus-plan user may own.", type: "number" },
  { key: "wiki_max_owned_pro", labelKey: "admin.wiki.settings.field.maxOwnedPro.label", labelDefault: "Max Owned Wikis — Pro", descriptionKey: "admin.wiki.settings.field.maxOwnedPro.description", descriptionDefault: "Max wikis a Pro-plan user may own.", type: "number" },
  { key: "wiki_max_owned_max", labelKey: "admin.wiki.settings.field.maxOwnedMax.label", labelDefault: "Max Owned Wikis — Max", descriptionKey: "admin.wiki.settings.field.maxOwnedMax.description", descriptionDefault: "Max wikis a Max-plan user may own.", type: "number" },
  { key: "wiki_max_pages_free", labelKey: "admin.wiki.settings.field.maxPagesFree.label", labelDefault: "Max Pages per Wiki — Free", descriptionKey: "admin.wiki.settings.field.maxPagesFree.description", descriptionDefault: "Max pages per wiki for a Free-plan owner.", type: "number" },
  { key: "wiki_max_pages_plus", labelKey: "admin.wiki.settings.field.maxPagesPlus.label", labelDefault: "Max Pages per Wiki — Plus", descriptionKey: "admin.wiki.settings.field.maxPagesPlus.description", descriptionDefault: "Max pages per wiki for a Plus-plan owner.", type: "number" },
  { key: "wiki_max_pages_pro", labelKey: "admin.wiki.settings.field.maxPagesPro.label", labelDefault: "Max Pages per Wiki — Pro", descriptionKey: "admin.wiki.settings.field.maxPagesPro.description", descriptionDefault: "Max pages per wiki for a Pro-plan owner.", type: "number" },
  { key: "wiki_max_pages_max", labelKey: "admin.wiki.settings.field.maxPagesMax.label", labelDefault: "Max Pages per Wiki — Max", descriptionKey: "admin.wiki.settings.field.maxPagesMax.description", descriptionDefault: "Max pages per wiki for a Max-plan owner.", type: "number" },
  { key: "wiki_max_selected_collaborators", labelKey: "admin.wiki.settings.field.maxSelectedCollaborators.label", labelDefault: "Max Selected Collaborators", descriptionKey: "admin.wiki.settings.field.maxSelectedCollaborators.description", descriptionDefault: "Max explicitly-selected/invited collaborators per wiki (contribute_policy = selected).", type: "number" },
  { key: "wiki_invite_expiry_hours", labelKey: "admin.wiki.settings.field.inviteExpiryHours.label", labelDefault: "Invite Expiry (Hours)", descriptionKey: "admin.wiki.settings.field.inviteExpiryHours.description", descriptionDefault: "Hours a wiki collaborator invite link remains valid.", type: "number" },
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

export default function AdminWikiSettingsPage() {
  const { t } = useTranslation();
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
      .catch(() => showToast(t("admin.wiki.settings.loadFailed", "Failed to load settings"), "error"))
      .finally(() => setLoading(false));
  }, [isAdmin, showToast, t]);

  async function save(key: string, value: string) {
    setSaving(key);
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error(t("admin.wiki.settings.saveFailed", "Save failed"));
      setValues((prev) => ({ ...prev, [key]: value }));
      showToast(t("admin.wiki.settings.saved", "Saved"));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("admin.wiki.settings.saveFailed", "Save failed"), "error");
    } finally {
      setSaving(null);
    }
  }

  if (isAdmin === false) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">{t("admin.wiki.settings.adminOnlyTitle", "Admin access required")}</p>
        <p className="mt-1 text-sm text-neutral-500">{t("admin.wiki.settings.adminOnlyBody", "Only administrators can change Wiki settings.")}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("admin.wiki.settings.title", "Wiki Settings")}</h1>
      <p className="mb-6 text-sm text-neutral-500">{t("admin.wiki.settings.subtitle", 'Also editable at /gate44/config under "x_manifest" search.')}</p>

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
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {FIELDS.map((field) => {
            const raw = values[field.key] ?? "";
            const isSaving = saving === field.key;
            return (
              <div key={field.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{t(field.labelKey, field.labelDefault)}</p>
                  <p className="text-xs text-neutral-500">{t(field.descriptionKey, field.descriptionDefault)}</p>
                </div>
                {field.type === "boolean" ? (
                  <ToggleSwitch checked={raw === "true"} disabled={isSaving} onChange={(v) => save(field.key, v ? "true" : "false")} />
                ) : field.type === "plan" ? (
                  <select
                    value={raw}
                    disabled={isSaving}
                    onChange={(e) => save(field.key, e.target.value)}
                    className="w-32 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                  >
                    {PLAN_OPTIONS.map((plan) => (
                      <option key={plan} value={plan}>
                        {t(`admin.wiki.settings.plan.${plan}`, plan.charAt(0).toUpperCase() + plan.slice(1))}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    defaultValue={raw}
                    disabled={isSaving}
                    onBlur={(e) => { if (e.target.value !== raw) save(field.key, e.target.value); }}
                    className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
