"use client";

/**
 * app/(admin)/admin/alerts/page.tsx
 *
 * Alerts dashboard for admin panel.
 * Shows active system alerts with severity badges.
 * Resolve alerts with a modal for resolution notes.
 * Resolved history with resolver info.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = "critical" | "warning" | "info";
type AlertStatus = "active" | "resolved";

type AlertType =
  | "low_payout_balance"
  | "large_withdrawal"
  | "report_spike"
  | "cron_failure"
  | "ai_api_error"
  | "other";

interface Alert {
  id: string;
  type: AlertType;
  severity: Severity;
  title: string;
  description: string;
  status: AlertStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_BADGE: Record<Severity, { classes: string; dot: string }> = {
  critical: { classes: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300", dot: "bg-red-500 animate-pulse" },
  warning: { classes: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", dot: "bg-amber-400" },
  info: { classes: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", dot: "bg-blue-400" },
};

const ALERT_TYPE_ICON: Record<AlertType, string> = {
  low_payout_balance: "💰",
  large_withdrawal: "⚠️",
  report_spike: "📈",
  cron_failure: "⏰",
  ai_api_error: "🤖",
  other: "🔔",
};

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
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Resolve modal
// ---------------------------------------------------------------------------

interface ResolveModalProps {
  alert: Alert;
  onResolve: (note: string) => Promise<void>;
  onClose: () => void;
}

function ResolveModal({ alert, onResolve, onClose }: ResolveModalProps) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onResolve(note);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-50">Resolve Alert</h3>
            <p className="text-sm text-neutral-500">{alert.title}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Resolution Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Describe how this was resolved…"
              className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
              {loading ? "Resolving…" : "Mark Resolved"}
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert card
// ---------------------------------------------------------------------------

interface AlertCardProps {
  alert: Alert;
  onResolve: (alert: Alert) => void;
}

function AlertCard({ alert, onResolve }: AlertCardProps) {
  const { classes, dot } = SEVERITY_BADGE[alert.severity];

  return (
    <div className={`rounded-xl border bg-white p-4 dark:bg-neutral-900 ${alert.severity === "critical" ? "border-red-200 dark:border-red-800" : alert.severity === "warning" ? "border-amber-200 dark:border-amber-800" : "border-blue-200 dark:border-blue-800"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 text-2xl">{ALERT_TYPE_ICON[alert.type]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${dot}`} />
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>{alert.severity}</span>
            </div>
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{alert.title}</h3>
            <span className="ml-auto text-xs text-neutral-400">{timeAgo(alert.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{alert.description}</p>

          {alert.status === "resolved" && (
            <div className="mt-2 rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
              Resolved {formatDate(alert.resolvedAt ?? "")} by @{alert.resolvedBy}
              {alert.resolutionNote && <> — {alert.resolutionNote}</>}
            </div>
          )}
        </div>

        {alert.status === "active" && (
          <button
            onClick={() => onResolve(alert)}
            className="shrink-0 rounded-lg bg-teal-100 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-200 dark:bg-teal-900 dark:text-teal-300"
          >
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin alerts dashboard.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminAlertsPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Alert | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/alerts", { credentials: "include" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error?.message ?? "Failed to load alerts") as Error & { code?: string | null };
        err.code = body.error?.code ?? null;
        throw err;
      }
      const data = (await res.json()) as { success: boolean; data: { alerts: Alert[]; total: number } };
      setAlerts(data.data?.alerts ?? []);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAlerts(); }, [fetchAlerts]);

  async function handleResolve(note: string) {
    if (!resolving) return;
    const res = await fetch(`/api/admin/alerts/${resolving.id}/resolve`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) { showToast("Failed to resolve", "error"); return; }
    showToast("Alert resolved");
    setResolving(null);
    await fetchAlerts();
  }

  const active = alerts.filter((a) => a.status === "active");
  const resolved = alerts.filter((a) => a.status === "resolved");

  const criticalCount = active.filter((a) => a.severity === "critical").length;

  return (
    <div className="relative space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Alerts Dashboard</h1>
        {criticalCount > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700 dark:bg-red-900 dark:text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            {criticalCount} critical
          </span>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {/* Active alerts */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Active Alerts</h2>
        <div className="space-y-3">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="mb-2 flex gap-2">
                  <div className="h-5 w-20 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                  <div className="h-5 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
                </div>
                <div className="h-3 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700" />
              </div>
            ))
            : active.length === 0
            ? (
              <div className="flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-5 py-6 dark:border-teal-800 dark:bg-teal-950/30">
                <span className="text-2xl">✓</span>
                <p className="font-semibold text-teal-700 dark:text-teal-300">No active alerts</p>
              </div>
            )
            : active.map((a) => <AlertCard key={a.id} alert={a} onResolve={setResolving} />)}
        </div>
      </div>

      {/* History toggle */}
      {resolved.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory((p) => !p)}
            className="flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            <span>{showHistory ? "▼" : "▶"}</span>
            Alert History ({resolved.length})
          </button>
          {showHistory && (
            <div className="mt-3 space-y-3">
              {resolved.map((a) => <AlertCard key={a.id} alert={a} onResolve={setResolving} />)}
            </div>
          )}
        </div>
      )}

      {/* Resolve modal */}
      {resolving && (
        <ResolveModal
          alert={resolving}
          onResolve={handleResolve}
          onClose={() => setResolving(null)}
        />
      )}
    </div>
  );
}
