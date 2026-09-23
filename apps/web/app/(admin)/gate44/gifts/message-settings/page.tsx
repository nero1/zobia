"use client";

/**
 * app/(admin)/gate44/gifts/message-settings/page.tsx
 *
 * Gift Message config — the optional "Add a message" box on the Send Gift
 * flow (PRD §12 Gift Economy). Controls the global on/off switch, the
 * minimum account level Free-plan users need, and per-plan/business-tier
 * on/off + max-word settings. A focused view of x_manifest rows, mirrors
 * app/(admin)/gate44/moderation/settings/page.tsx. Admin-only.
 */

import { useState, useEffect, useCallback } from "react";

interface FieldMeta {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number";
}

const GLOBAL_FIELDS: FieldMeta[] = [
  { key: "gift_message_enabled", label: "Gift Messages Enabled", description: "Master on/off switch for the optional gift message feature, sitewide.", type: "boolean" },
  { key: "gift_message_free_min_level", label: "Free Plan — Minimum Level", description: "Minimum account level (main rank number) a Free-plan user needs to unlock the gift message box.", type: "number" },
];

const TIER_FIELDS: { tier: string; label: string }[] = [
  { tier: "free", label: "Free" },
  { tier: "plus", label: "Plus" },
  { tier: "pro", label: "Pro" },
  { tier: "max", label: "Max" },
  { tier: "business_starter", label: "Business Starter" },
  { tier: "business_growth", label: "Business Growth" },
  { tier: "business_enterprise", label: "Business Enterprise" },
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

function TierRow({
  tier,
  label,
  values,
  saving,
  onSave,
}: {
  tier: string;
  label: string;
  values: Record<string, string>;
  saving: string | null;
  onSave: (key: string, value: string) => void;
}) {
  const enabledKey = `gift_message_enabled_${tier}`;
  const maxWordsKey = `gift_message_max_words_${tier}`;
  const enabled = (values[enabledKey] ?? "") === "true";
  const maxWords = values[maxWordsKey] ?? "";

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{label}</p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Max words</span>
          <input
            type="number"
            defaultValue={maxWords}
            disabled={saving === maxWordsKey}
            onBlur={(e) => { if (e.target.value !== maxWords) onSave(maxWordsKey, e.target.value); }}
            className="w-20 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">On</span>
          <ToggleSwitch checked={enabled} disabled={saving === enabledKey} onChange={(v) => onSave(enabledKey, v ? "true" : "false")} />
        </div>
      </div>
    </div>
  );
}

export default function GiftMessageSettingsPage() {
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
      </div>
    );
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Gift Message Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Configure the optional &quot;Add a message&quot; box on Send Gift. Free-plan users unlock it at a minimum account
        level; every plan and business tier has an independent on/off toggle and max-word limit. Also editable at
        /gate44/config.
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
          <FieldGroup title="Global" fields={GLOBAL_FIELDS} values={values} saving={saving} onSave={save} />
          <div className="mb-6">
            <h2 className="mb-1 text-sm font-bold text-neutral-900 dark:text-neutral-50">Per Plan / Tier</h2>
            <p className="mb-2 text-xs text-neutral-500">
              Free is additionally gated by the minimum level above. Paid plans and Business tiers are on by default
              with increasing max-word ceilings.
            </p>
            <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
              {TIER_FIELDS.map((t) => (
                <TierRow key={t.tier} tier={t.tier} label={t.label} values={values} saving={saving} onSave={save} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
