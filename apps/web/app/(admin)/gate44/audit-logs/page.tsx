"use client";

/**
 * app/(admin)/admin/audit-logs/page.tsx
 *
 * Read-only viewer over the platform's two audit trails:
 *  - "Admin Actions" (admin_audit_log) — config changes, KYC decisions,
 *    payout approvals, feature flag flips, ads moderation, impersonation, etc.
 *  - "Security Events" (audit_log) — login/logout, 2FA, PIN changes,
 *    admin ban/suspend, session rotation.
 *
 * Data from GET /api/admin/audit-logs?source=admin|security. Keyset
 * pagination (Load More) — no OFFSET, so this stays fast at any table size.
 * Retention is handled by the daily-platform cron (lib/audit/pruneAuditLogs.ts).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Source = "admin" | "security";

interface AdminAuditEntry {
  id: string;
  adminId: string;
  adminUsername: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  targetType: string | null;
  targetId: string | null;
  beforeVal: unknown;
  afterVal: unknown;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
}

interface SecurityAuditEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

type AuditEntry = AdminAuditEntry | SecurityAuditEntry;

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
    second: "2-digit",
  });
}

function jsonPreview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Row skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <tr>
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Detail modal — full metadata / before-after diff for one entry
// ---------------------------------------------------------------------------

function DetailModal({ entry, source, onClose }: { entry: AuditEntry; source: Source; onClose: () => void }) {
  const admin = source === "admin" ? (entry as AdminAuditEntry) : null;
  const security = source === "security" ? (entry as SecurityAuditEntry) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">
            {entry.action.replace(/_/g, " ")}
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-xs text-neutral-500">{formatDate(entry.createdAt)}</p>
          <p>
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">Actor: </span>
            {admin ? (admin.adminUsername ? `@${admin.adminUsername}` : admin.adminId) : security?.actorUsername ? `@${security.actorUsername}` : security?.actorId ?? "—"}
          </p>
          {(entry.targetType || entry.targetId) && (
            <p>
              <span className="font-semibold text-neutral-700 dark:text-neutral-300">Target: </span>
              {entry.targetType ?? "—"} {entry.targetId ? `(${entry.targetId})` : ""}
            </p>
          )}
          {admin?.resource && (
            <p>
              <span className="font-semibold text-neutral-700 dark:text-neutral-300">Resource: </span>
              {admin.resource} {admin.resourceId ? `(${admin.resourceId})` : ""}
            </p>
          )}
          {entry.ipAddress && (
            <p>
              <span className="font-semibold text-neutral-700 dark:text-neutral-300">IP: </span>
              {entry.ipAddress}
            </p>
          )}
          {security?.userAgent && (
            <p className="break-all">
              <span className="font-semibold text-neutral-700 dark:text-neutral-300">User agent: </span>
              {security.userAgent}
            </p>
          )}
          {admin && jsonPreview(admin.beforeVal) && (
            <div>
              <p className="mb-1 font-semibold text-neutral-700 dark:text-neutral-300">Before</p>
              <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-2 text-xs dark:bg-neutral-800">{jsonPreview(admin.beforeVal)}</pre>
            </div>
          )}
          {admin && jsonPreview(admin.afterVal) && (
            <div>
              <p className="mb-1 font-semibold text-neutral-700 dark:text-neutral-300">After</p>
              <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-2 text-xs dark:bg-neutral-800">{jsonPreview(admin.afterVal)}</pre>
            </div>
          )}
          {jsonPreview(entry.metadata) && (
            <div>
              <p className="mb-1 font-semibold text-neutral-700 dark:text-neutral-300">Metadata</p>
              <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-2 text-xs dark:bg-neutral-800">{jsonPreview(entry.metadata)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminAuditLogsPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  const [source, setSource] = useState<Source>("admin");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchEntries = useCallback(async (resetCursor: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ source });
      if (actionFilter.trim()) params.set("action", actionFilter.trim());
      if (actorFilter.trim()) params.set("actorId", actorFilter.trim());
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (!resetCursor && cursor) params.set("cursor", cursor);

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/gate44/login"; return; }
      if (!res.ok) throw new Error("Failed to load audit logs");
      const body = (await res.json()) as { data: { items: AuditEntry[]; hasMore: boolean; nextCursor: string | null } };
      setEntries((prev) => (resetCursor ? body.data.items : [...prev, ...body.data.items]));
      setNextCursor(body.data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [source, actionFilter, actorFilter, startDate, endDate, cursor]);

  useEffect(() => {
    setCursor(null);
    void fetchEntries(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, actionFilter, actorFilter, startDate, endDate]);

  function handleLoadMore() {
    if (nextCursor) {
      setCursor(nextCursor);
      void fetchEntries(false);
    }
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Audit Logs</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Immutable, read-only record of admin actions and security events. Retained for 365 days,
        then automatically pruned by the daily platform cron job.
      </p>

      {/* Source tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900 w-fit">
        {(["admin", "security"] as Source[]).map((s) => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              source === s
                ? "bg-blue-600 text-white"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {s === "admin" ? "Admin Actions" : "Security Events"}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Action</label>
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="e.g. admin_ban_user"
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Actor UUID</label>
          <input
            type="text"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="Admin or user ID"
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">From Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">To Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              {["Action", "Actor", "Target", "Timestamp", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading && entries.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">🧾</span>
                    <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">No audit entries found</p>
                    <p className="text-xs text-neutral-400">Try adjusting your filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const admin = source === "admin" ? (entry as AdminAuditEntry) : null;
                const security = source === "security" ? (entry as SecurityAuditEntry) : null;
                const actorLabel = admin
                  ? admin.adminUsername ?? admin.adminId.slice(0, 8)
                  : security?.actorUsername ?? security?.actorId?.slice(0, 8) ?? "system";
                return (
                  <tr key={entry.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        {entry.action.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">@{actorLabel}</td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {entry.targetType ? `${entry.targetType}${entry.targetId ? ` · ${entry.targetId.slice(0, 8)}…` : ""}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">{formatDate(entry.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDetail(entry)}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {loading ? "Loading…" : "Load More"}
          </button>
        </div>
      )}

      {detail && <DetailModal entry={detail} source={source} onClose={() => setDetail(null)} />}
    </div>
  );
}
