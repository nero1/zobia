"use client";

/**
 * app/(admin)/gate44/moderation/appeals/page.tsx
 *
 * Admin/moderator review queue for Account Appeals (suspension/ban appeals).
 * Mirrors app/(admin)/gate44/payouts/appeals/page.tsx's structure and
 * styling. Approve lifts the suspension/ban (via the same restore logic as
 * the direct admin action); Deny increments the appeal's refusal count —
 * once a user's denials for this action reach the configured cap, further
 * submissions are blocked (enforced by POST /api/appeals).
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiTriageResult {
  recommendation: "likely_valid" | "likely_invalid" | "uncertain";
  confidence: number;
  reasoning: string;
  provider: string;
}

interface Appeal {
  id: string;
  userId: string;
  username: string | null;
  email: string | null;
  currentlySuspended: boolean;
  currentlyBanned: boolean;
  suspensionReason: string | null;
  suspendedUntil: string | null;
  banReason: string | null;
  appealType: "suspension" | "ban";
  reason: string;
  contactEmail: string | null;
  status: "pending" | "under_review" | "approved" | "denied";
  refusalCount: number;
  aiTriageResult: AiTriageResult | null;
  adminNotes: string | null;
  createdAt: string;
}

type TabKey = "pending" | "approved" | "denied";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const TRIAGE_BADGE: Record<AiTriageResult["recommendation"], string> = {
  likely_valid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  likely_invalid: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  uncertain: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

// ---------------------------------------------------------------------------
// Settings panel (x_manifest appeals_max_refusals / appeals_triage_mode)
// ---------------------------------------------------------------------------

function SettingsPanel({
  maxRefusals,
  triageMode,
  onSave,
}: {
  maxRefusals: string;
  triageMode: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function handleSave(key: string, value: string) {
    setSavingKey(key);
    try {
      await onSave(key, value);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-bold text-neutral-900 dark:text-neutral-50">Appeal Settings</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Max refusals before appeals are blocked
          </label>
          <input
            type="number"
            min={1}
            defaultValue={maxRefusals}
            disabled={savingKey === "appeals_max_refusals"}
            onBlur={(e) => { if (e.target.value !== maxRefusals) void handleSave("appeals_max_refusals", e.target.value); }}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Triage mode
          </label>
          <select
            defaultValue={triageMode}
            disabled={savingKey === "appeals_triage_mode"}
            onChange={(e) => void handleSave("appeals_triage_mode", e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
          >
            <option value="manual">Manual (always human review)</option>
            <option value="ai_then_manual">AI triage, then manual</option>
          </select>
        </div>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        AI triage only produces a recommendation for the reviewer below — it never auto-approves or auto-denies.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appeal card
// ---------------------------------------------------------------------------

function AppealCard({
  appeal,
  onApprove,
  onDeny,
  busy,
}: {
  appeal: Appeal;
  onApprove: (id: string, notes: string) => Promise<void>;
  onDeny: (id: string, notes: string) => Promise<void>;
  busy: string | null;
}) {
  const [notes, setNotes] = useState("");
  const isBusy = busy === appeal.id;
  const isPending = appeal.status === "pending" || appeal.status === "under_review";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-neutral-900 dark:text-neutral-100">
            @{appeal.username ?? "unknown"}
          </p>
          <p className="text-xs text-neutral-400">{appeal.contactEmail ?? appeal.email ?? "no contact email"}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${appeal.appealType === "ban" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"}`}>
            {appeal.appealType === "ban" ? "Ban appeal" : "Suspension appeal"}
          </span>
          {appeal.refusalCount > 0 && (
            <span className="text-xs text-neutral-400">Denied {appeal.refusalCount}x before</span>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs text-neutral-500">
        <span title={appeal.createdAt}>Submitted {timeAgo(appeal.createdAt)} ({formatDate(appeal.createdAt)})</span>
        {appeal.appealType === "suspension" && appeal.suspendedUntil && (
          <span>· Lifts {formatDate(appeal.suspendedUntil)}</span>
        )}
      </div>

      {(appeal.suspensionReason || appeal.banReason) && (
        <div className="mb-3 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          <p className="mb-0.5 font-semibold">Original action reason:</p>
          <p>{appeal.appealType === "ban" ? appeal.banReason : appeal.suspensionReason}</p>
        </div>
      )}

      <div className="mb-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
        <p className="mb-0.5 font-semibold">User&apos;s appeal:</p>
        <p className="whitespace-pre-wrap">{appeal.reason}</p>
      </div>

      {appeal.aiTriageResult && (
        <div className="mb-3 rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-700">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">AI triage:</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${TRIAGE_BADGE[appeal.aiTriageResult.recommendation]}`}>
              {appeal.aiTriageResult.recommendation.replace(/_/g, " ")}
            </span>
            <span className="text-neutral-400">{Math.round(appeal.aiTriageResult.confidence * 100)}% confidence</span>
          </div>
          <p className="text-neutral-500">{appeal.aiTriageResult.reasoning}</p>
        </div>
      )}

      {appeal.adminNotes && (
        <div className="mb-3 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          <p className="mb-0.5 font-semibold">Admin notes:</p>
          <p>{appeal.adminNotes}</p>
        </div>
      )}

      {isPending && (
        isBusy ? (
          <div className="flex justify-center py-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-blue-600" />
          </div>
        ) : (
          <div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional admin notes (not shown to the user)…"
              rows={2}
              className="mb-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => onDeny(appeal.id, notes)}
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Deny
              </button>
              <button
                onClick={() => onApprove(appeal.id, notes)}
                className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                Approve &amp; Restore Account
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AccountAppealsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("pending");
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [maxRefusals, setMaxRefusals] = useState("3");
  const [triageMode, setTriageMode] = useState("manual");

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/config", { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      const entries: { key: string; value: string }[] = json?.data ?? json?.entries ?? [];
      for (const e of entries) {
        if (e.key === "appeals_max_refusals") setMaxRefusals(e.value);
        if (e.key === "appeals_triage_mode") setTriageMode(e.value);
      }
    } catch {
      // Non-fatal — defaults stay in place
    }
  }, []);

  const fetchAppeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = tab === "pending" ? "pending" : tab;
      const res = await fetch(`/api/admin/appeals?status=${status}&limit=50`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/gate44/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load appeals");
      const json = await res.json();
      setAppeals(json?.data?.appeals ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void fetchSettings(); }, [fetchSettings]);
  useEffect(() => { void fetchAppeals(); }, [fetchAppeals]);

  async function saveSetting(key: string, value: string) {
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Save failed");
      if (key === "appeals_max_refusals") setMaxRefusals(value);
      if (key === "appeals_triage_mode") setTriageMode(value);
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    }
  }

  async function handleAction(id: string, action: "approve" | "deny", notes: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/appeals/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, adminNotes: notes || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(
          (body as { error?: { message?: string } }).error?.message ?? `Failed to ${action} appeal`
        ) as Error & { code?: string | null };
        err.code = (body as { error?: { code?: string } }).error?.code ?? null;
        throw err;
      }
      showToast(`Appeal ${action === "approve" ? "approved — account restored" : "denied"}`);
      await fetchAppeals();
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(
        e instanceof Error ? translateApiError(t, err.code, err.message || "Error") : "Error",
        "error"
      );
    } finally {
      setBusy(null);
    }
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "denied", label: "Denied" },
  ];

  return (
    <div className="relative">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Account Appeals</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Suspension and ban appeals, submitted only from a verified blocked-login attempt. Approving restores the account
        (lifts the suspension/ban) via the same action as a direct admin restore.
      </p>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <SettingsPanel maxRefusals={maxRefusals} triageMode={triageMode} onSave={saveSetting} />

      <div className="mb-4 flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-3 py-2 text-sm font-medium ${tab === tb.key ? "border-b-2 border-primary-600 text-primary-600" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && (
        <p className="mb-4 text-sm text-neutral-500">
          {appeals.length} {tab} appeal{appeals.length !== 1 ? "s" : ""}
        </p>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
          ))}
        </div>
      ) : appeals.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-14 text-center text-sm text-neutral-500 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          No {tab} appeals.
        </div>
      ) : (
        <div className="space-y-4">
          {appeals.map((appeal) => (
            <AppealCard
              key={appeal.id}
              appeal={appeal}
              onApprove={(id, notes) => handleAction(id, "approve", notes)}
              onDeny={(id, notes) => handleAction(id, "deny", notes)}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
