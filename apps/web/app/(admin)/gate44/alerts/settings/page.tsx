"use client";

/**
 * app/(admin)/gate44/alerts/settings/page.tsx
 *
 * Alert system settings — per-level channel toggles, Level 1/2 escalation
 * schedule, mass-report-spike thresholds, and staff SMS contacts. Mirrors
 * app/(admin)/gate44/moderation/settings/page.tsx (generic x_manifest
 * key/value editing via /api/admin/config/[key]). Admin-only.
 */

import { useState, useEffect, useCallback } from "react";
import { ALERT_PRIORITY_LEVELS, type AlertPriorityLevel } from "@/lib/alerts/types";

// ---------------------------------------------------------------------------
// Manifest field groups
// ---------------------------------------------------------------------------

interface FieldMeta {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number" | "text";
}

const LEVELS: AlertPriorityLevel[] = [1, 2, 3, 4, 5, 6];

function channelFields(level: AlertPriorityLevel): FieldMeta[] {
  const locked = level > 2;
  return [
    { key: `alert_level_${level}_channel_sms`, label: "SMS", description: locked ? "SMS is hard-disabled above Level 2 regardless of this flag." : "Page via SMS (Termii).", type: "boolean" },
    { key: `alert_level_${level}_channel_email`, label: "Email", description: "Send via Mailgun.", type: "boolean" },
    { key: `alert_level_${level}_channel_telegram`, label: "Telegram", description: "DM via the Telegram bot.", type: "boolean" },
    { key: `alert_level_${level}_channel_push`, label: "Push", description: "Mobile/web push notification.", type: "boolean" },
    { key: `alert_level_${level}_channel_in_app`, label: "In-App", description: "In-app notification bell.", type: "boolean" },
  ];
}

const ESCALATION_FIELDS: FieldMeta[] = [
  { key: "alert_level1_escalation_schedule", label: "Level 1 Backoff Schedule (hours, comma-separated)", description: "Hour offsets for each re-notification stage within one cycle, e.g. 1,2,4,8,16,32.", type: "text" },
  { key: "alert_level1_escalation_cycles", label: "Level 1 Backoff Cycles", description: "How many times the schedule above repeats before switching to daily paging.", type: "number" },
  { key: "alert_level1_daily_phase_days", label: "Level 1 Daily Phase (days)", description: "Days Level 1 pages once/day after backoff cycles are exhausted.", type: "number" },
  { key: "alert_level1_weekly_phase_weeks", label: "Level 1 Weekly Phase (weeks)", description: "Weeks Level 1 pages once/week after the daily phase, before stopping permanently.", type: "number" },
  { key: "alert_level2_escalation_schedule", label: "Level 2 Backoff Schedule (hours, comma-separated)", description: "Hour offsets for each re-notification stage within one cycle.", type: "text" },
  { key: "alert_level2_escalation_cycles", label: "Level 2 Backoff Cycles", description: "How many times the schedule above repeats before switching to daily paging.", type: "number" },
  { key: "alert_level2_daily_phase_days", label: "Level 2 Daily Phase (days)", description: "Days Level 2 pages once/day after backoff cycles are exhausted.", type: "number" },
  { key: "alert_level2_weekly_phase_weeks", label: "Level 2 Weekly Phase (weeks)", description: "Weeks Level 2 pages once/week after the daily phase. 0 = stop after daily.", type: "number" },
];

const REPORT_SPIKE_FIELDS: FieldMeta[] = [
  { key: "alert_report_spike_level5_threshold", label: "Level 5 Threshold", description: "Distinct reporters on one content cluster.", type: "number" },
  { key: "alert_report_spike_level4_threshold", label: "Level 4 Threshold", description: "Distinct reporters on one content cluster.", type: "number" },
  { key: "alert_report_spike_level3_threshold", label: "Level 3 Threshold", description: "Distinct reporters on one content cluster.", type: "number" },
  { key: "alert_report_spike_level2_velocity_threshold", label: "Level 2 Sitewide Velocity Threshold", description: "Total reports across ALL targets in the last hour — crossing this suggests brigading/an attack, not one bad post.", type: "number" },
];

const MISC_FIELDS: FieldMeta[] = [
  { key: "alert_notify_mods_infra_other", label: "Notify Mods for Infra/Other Alerts", description: "Site/security/moderation alerts always notify mods; financial alerts never do. This controls infra/other-category alerts only.", type: "boolean" },
  { key: "alert_sms_provider", label: "SMS Provider", description: "Active SMS provider key for Level 1/2 paging.", type: "text" },
];

// ---------------------------------------------------------------------------
// Shared field-editing UI
// ---------------------------------------------------------------------------

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

function FieldRow({ field, value, saving, onSave }: { field: FieldMeta; value: string; saving: boolean; onSave: (key: string, value: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{field.label}</p>
        <p className="text-xs text-neutral-500">{field.description}</p>
      </div>
      {field.type === "boolean" ? (
        <ToggleSwitch checked={value === "true"} disabled={saving} onChange={(v) => onSave(field.key, v ? "true" : "false")} />
      ) : (
        <input
          type={field.type === "number" ? "number" : "text"}
          defaultValue={value}
          disabled={saving}
          onBlur={(e) => { if (e.target.value !== value) onSave(field.key, e.target.value); }}
          className="w-40 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
        />
      )}
    </div>
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
        {fields.map((field) => (
          <FieldRow key={field.key} field={field} value={values[field.key] ?? ""} saving={saving === field.key} onSave={onSave} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff SMS contacts
// ---------------------------------------------------------------------------

interface StaffContact {
  userId: string;
  username: string;
  isAdmin: boolean;
  isModerator: boolean;
  phoneNumber: string | null;
  smsEnabled: boolean;
}

function StaffContactRow({ contact, onSave }: { contact: StaffContact; onSave: (userId: string, phoneNumber: string | null, smsEnabled: boolean) => Promise<void> }) {
  const [phone, setPhone] = useState(contact.phoneNumber ?? "");
  const [enabled, setEnabled] = useState(contact.smsEnabled);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(contact.userId, phone.trim() || null, enabled);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-[140px]">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">@{contact.username}</p>
        <p className="text-xs text-neutral-500">{contact.isAdmin ? "Admin" : "Moderator"}</p>
      </div>
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+2348012345678"
        className="w-44 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
      />
      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
        <ToggleSwitch checked={enabled} onChange={setEnabled} />
        SMS enabled
      </label>
      <button
        onClick={handleSave}
        disabled={saving}
        className="ml-auto rounded-lg bg-teal-100 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AlertSettingsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<StaffContact[]>([]);
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
    Promise.all([
      fetch("/api/admin/config", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/admin/alerts/contacts", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([configJson, contactsJson]) => {
        const entries: { key: string; value: string }[] = configJson?.data ?? configJson?.entries ?? [];
        const map: Record<string, string> = {};
        for (const e of entries) map[e.key] = e.value;
        setValues(map);
        setContacts(contactsJson?.data?.contacts ?? []);
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

  async function saveContact(userId: string, phoneNumber: string | null, smsEnabled: boolean) {
    try {
      const res = await fetch(`/api/admin/alerts/contacts/${userId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, smsEnabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? "Save failed");
      }
      setContacts((prev) => prev.map((c) => (c.userId === userId ? { ...c, phoneNumber, smsEnabled } : c)));
      showToast("Contact saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    }
  }

  if (isAdmin === false) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">Admin access required</p>
        <p className="mt-1 text-sm text-neutral-500">Only administrators can change alert settings.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Alert Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Per-level notification channels, Level 1/2 escalation schedules, and mass-report-spike thresholds for the 6-level
        admin/mod alert system. Only Level 1 and Level 2 ever send SMS. See the{" "}
        <a href="/gate44/alerts" className="text-teal-600 hover:underline dark:text-teal-400">Alerts Dashboard</a> for active alerts.
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
          {LEVELS.map((level) => {
            const def = ALERT_PRIORITY_LEVELS[level];
            return (
              <FieldGroup
                key={level}
                title={`Level ${level} — ${def.label}`}
                description={def.description}
                fields={channelFields(level)}
                values={values}
                saving={saving}
                onSave={save}
              />
            );
          })}

          <FieldGroup
            title="Level 1/2 Escalation Schedule"
            description="Hour-based backoff that repeats until an alert is resolved, then daily, then weekly, then stops. See PRD §20 for the full spec."
            fields={ESCALATION_FIELDS}
            values={values}
            saving={saving}
            onSave={save}
          />

          <FieldGroup
            title="Mass Report Spike Thresholds"
            description="Distinct-reporter counts on a single content cluster that raise a mass-report alert at increasing priority. Level 2 uses a separate sitewide velocity check for brigading/attacks."
            fields={REPORT_SPIKE_FIELDS}
            values={values}
            saving={saving}
            onSave={save}
          />

          <FieldGroup title="Miscellaneous" fields={MISC_FIELDS} values={values} saving={saving} onSave={save} />

          <div className="mb-6">
            <h2 className="mb-1 text-sm font-bold text-neutral-900 dark:text-neutral-50">Staff SMS Contacts</h2>
            <p className="mb-2 text-xs text-neutral-500">
              Phone numbers used ONLY for Level 1/2 alert paging via SMS. Kept separate from user accounts — the platform
              has no other SMS usage.
            </p>
            <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
              {contacts.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-neutral-500">No admins/moderators found.</p>
              ) : (
                contacts.map((c) => <StaffContactRow key={c.userId} contact={c} onSave={saveContact} />)
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
