"use client";

/**
 * app/(admin)/admin/support/settings/page.tsx
 *
 * Support Ticket System config — mirrors app/(admin)/admin/forum/settings/page.tsx's
 * shape exactly (same generic x_manifest read/write endpoints). Admin-only.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface FieldMeta {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number" | "text";
}

const FIELDS: FieldMeta[] = [
  { key: "feature_support_tickets", label: "Enable Support Tickets", description: "Master toggle. When off, all /api/support endpoints return 503.", type: "boolean" },
  { key: "support_ai_triage_enabled", label: "AI Triage", description: "When on, a new ticket first gets an AI-generated response before the human queue.", type: "boolean" },
  { key: "support_eligible_plans", label: "Free-Access Plans (JSON)", description: 'JSON array of plan slugs and/or "prestige_N" entries that can create tickets for free, e.g. ["plus","pro","max"].', type: "text" },
  { key: "support_ticket_cost_credits", label: "Ticket Cost (Credits)", description: "One-time credits charged to create a ticket for users not covered by Free-Access Plans. 0 = not payable in credits.", type: "number" },
  { key: "support_ticket_cost_stars", label: "Ticket Cost (Stars)", description: "One-time stars charged to create a ticket for users not covered by Free-Access Plans. 0 = not payable in stars.", type: "number" },
  { key: "support_charging_model", label: "Message Charging Model", description: "first_message_only | every_message | every_x_messages | first_x_messages", type: "text" },
  { key: "support_charging_x", label: "Charging Model X", description: "The X parameter for every_x_messages / first_x_messages.", type: "number" },
  { key: "support_staff_roles", label: "Staff Roles (JSON)", description: 'JSON array of roles that can view/respond to tickets, e.g. ["support","moderator","admin"].', type: "text" },
  { key: "feature_help_center_ai", label: "Enable Help Center \"Ask AI\"", description: "Independent of Support Tickets — controls the Ask AI block on Help Center doc pages.", type: "boolean" },
  { key: "help_center_ai_free_for_all", label: "Help Center Contact-a-Human Always Free", description: "When on, \"Contact a real person\" from a Help Center AI answer is always free and cost messaging is hidden.", type: "boolean" },
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

export default function AdminSupportSettingsPage() {
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
        <p className="mt-1 text-sm text-neutral-500">Only administrators can change Support settings.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Support Ticket Settings</h1>
          <p className="mt-1 text-sm text-neutral-500">Also editable at /admin/config — both write the same values.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/support/queue" className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700">
            Ticket Queue
          </Link>
          <Link href="/admin/users" className="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300">
            Grant Support Roles
          </Link>
        </div>
      </div>

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
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{field.label}</p>
                  <p className="text-xs text-neutral-500">{field.description}</p>
                </div>
                {field.type === "boolean" ? (
                  <ToggleSwitch checked={raw === "true"} disabled={isSaving} onChange={(v) => save(field.key, v ? "true" : "false")} />
                ) : field.type === "number" ? (
                  <input
                    type="number"
                    defaultValue={raw}
                    disabled={isSaving}
                    onBlur={(e) => { if (e.target.value !== raw) save(field.key, e.target.value); }}
                    className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                  />
                ) : (
                  <input
                    type="text"
                    defaultValue={raw}
                    disabled={isSaving}
                    onBlur={(e) => { if (e.target.value !== raw) save(field.key, e.target.value); }}
                    className="w-72 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
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
