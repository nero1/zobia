"use client";

/**
 * app/(admin)/gate44/data-management/page.tsx
 *
 * Centralized Data Management admin utility. Tabs: Users (default),
 * Financial, Statistical — selected via ?tab= query param. Each tab shows
 * cached quick-stat cards (30-minute Redis cache, see
 * lib/admin/statsCache.ts) with a "Refresh live data" button that bypasses
 * the cache. No live-updating stats.
 *
 * Users tab embeds the shared components/admin/UserManagementTable (the
 * same search/view/impersonate/suspend/ban UI as /gate44/users) plus new
 * toolbar controls: Create user, Export, Import, and a Delete action wired
 * into the table's detail drawer.
 */

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import UserManagementTable, { ALLOWED_FIELD_LABELS } from "@/components/admin/UserManagementTable";
import { useTranslation } from "react-i18next";

type Tab = "users" | "financial" | "statistical";

// ---------------------------------------------------------------------------
// Stat card primitives (visual language matches gate44/financial's SummaryCard)
// ---------------------------------------------------------------------------

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{value}</p>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-8 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ---------------------------------------------------------------------------
// useStats hook
// ---------------------------------------------------------------------------

function useStats(tab: Tab) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (live: boolean) => {
    if (live) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch(`/api/admin/data-management/stats?tab=${tab}${live ? "&live=1" : ""}`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      setData(json.data);
      setCachedAt(json.cachedAt);
      setIsLive(json.isLive);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => { void load(false); }, [load]);

  return { data, cachedAt, isLive, loading, refreshing, refresh: () => load(true) };
}

function StatsHeader({ cachedAt, isLive, refreshing, onRefresh }: { cachedAt: string | null; isLive: boolean; refreshing: boolean; onRefresh: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
      <span>
        {cachedAt ? (isLive ? `Live as of ${timeAgo(cachedAt)}` : `Cached ${timeAgo(cachedAt)}`) : ""}
      </span>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="rounded-lg border border-neutral-200 px-3 py-1.5 font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {refreshing ? "Refreshing…" : "Refresh live data"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export modal
// ---------------------------------------------------------------------------

const EXPORT_FIELD_OPTIONS = [
  "id", "username", "email", "displayName", "plan", "trustScore", "xpTotal",
  "isVerified", "isBanned", "isSuspended", "isModerator", "city", "country",
  "locale", "createdAt", "lastActiveAt", "coinBalance", "starBalance",
  "guildId", "referralCode", "kycTier",
] as const;

function ExportModal({ selectedIds, onClose, showToast }: { selectedIds: string[]; onClose: () => void; showToast: (m: string, t?: "success" | "error") => void }) {
  const [format, setFormat] = useState<"csv" | "tsv" | "xlsx">("csv");
  const [fields, setFields] = useState<string[]>(["id", "username", "email", "plan", "trustScore", "xpTotal", "createdAt"]);
  const [plan, setPlan] = useState("");
  const [minTrustScore, setMinTrustScore] = useState("");
  const [country, setCountry] = useState("");
  const [isBanned, setIsBanned] = useState<"" | "true" | "false">("");
  const [leaderboardTop1, setLeaderboardTop1] = useState(false);
  const [useSelection, setUseSelection] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [accountsSubmitting, setAccountsSubmitting] = useState(false);

  function toggleField(f: string) {
    setFields((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  async function submitExport() {
    setSubmitting(true);
    try {
      const filters: Record<string, unknown> = {};
      if (!useSelection) {
        if (plan) filters.plan = plan;
        if (minTrustScore) filters.minTrustScore = Number(minTrustScore);
        if (country) filters.country = country;
        if (isBanned) filters.isBanned = isBanned === "true";
        if (leaderboardTop1) filters.leaderboardRank = 1;
      } else {
        filters.userIds = selectedIds;
      }

      const res = await fetch("/api/admin/data-management/users/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, fields, filters }),
      });
      if (!res.ok) {
        showToast("Export failed", "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      showToast("Export ready — opened in a new tab");
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAccountsExport() {
    setAccountsSubmitting(true);
    try {
      const res = await fetch("/api/admin/data-management/users/export-accounts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeCredentials }),
      });
      if (!res.ok) {
        showToast("Account export failed", "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      showToast("Full account export ready — opened in a new tab");
    } finally {
      setAccountsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50">Export Users</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">Format</label>
            <div className="flex gap-2">
              {(["csv", "tsv", "xlsx"] as const).map((f) => (
                <button key={f} onClick={() => setFormat(f)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${format === f ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"}`}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">Fields</label>
            <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
              {EXPORT_FIELD_OPTIONS.map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300">
                  <input type="checkbox" checked={fields.includes(f)} onChange={() => toggleField(f)} />
                  {ALLOWED_FIELD_LABELS[f] ?? f}
                </label>
              ))}
            </div>
          </div>

          {selectedIds.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
              <input type="checkbox" checked={useSelection} onChange={(e) => setUseSelection(e.target.checked)} />
              Export only the {selectedIds.length} selected user(s) instead of using filters below
            </label>
          )}

          <fieldset disabled={useSelection} className="space-y-2 rounded-lg border border-neutral-200 p-3 disabled:opacity-40 dark:border-neutral-800">
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500">Filters</label>
            <div className="grid grid-cols-2 gap-2">
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                <option value="">Any plan</option>
                <option value="free">Free</option>
                <option value="plus">Plus</option>
                <option value="pro">Pro</option>
                <option value="max">Max</option>
              </select>
              <input value={minTrustScore} onChange={(e) => setMinTrustScore(e.target.value)} placeholder="Min trust score" type="number" className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200" />
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country code (e.g. NG)" className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200" />
              <select value={isBanned} onChange={(e) => setIsBanned(e.target.value as "" | "true" | "false")} className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                <option value="">Any ban status</option>
                <option value="true">Banned only</option>
                <option value="false">Not banned</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
              <input type="checkbox" checked={leaderboardTop1} onChange={(e) => setLeaderboardTop1(e.target.checked)} />
              Only the #1 XP earner (leaderboard rank 1)
            </label>
          </fieldset>

          <button
            onClick={() => void submitExport()}
            disabled={submitting || fields.length === 0}
            className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-600 px-3 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Exporting…" : "Export"}
          </button>

          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Full account export (for moving to a new install)</p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Streams every matching account as NDJSON, one JSON object per line, for re-import on another Zobia deployment.
            </p>
            <label className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
              <input type="checkbox" checked={includeCredentials} onChange={(e) => setIncludeCredentials(e.target.checked)} />
              Include credentials (password hash, TOTP secret) so accounts stay login-capable — ⚠️ highly sensitive file
            </label>
            <button
              onClick={() => void submitAccountsExport()}
              disabled={accountsSubmitting}
              className="flex min-h-[40px] w-full items-center justify-center rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {accountsSubmitting ? "Exporting…" : "Export Full Accounts (NDJSON)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import modal
// ---------------------------------------------------------------------------

interface ImportJobStatus {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  totalRows: number;
  processedRows: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
}

function ImportModal({ onClose, showToast }: { onClose: () => void; showToast: (m: string, t?: "success" | "error") => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dedupeStrategy, setDedupeStrategy] = useState<"skip" | "overwrite">("skip");
  const [job, setJob] = useState<ImportJobStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function processNextBatch(jobId: string) {
    const res = await fetch(`/api/admin/data-management/users/import/${jobId}`, { method: "POST", credentials: "include" });
    if (!res.ok) return;
    const json = (await res.json()) as ImportJobStatus;
    setJob(json);
    if (json.status === "completed" || json.status === "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
      showToast(json.status === "completed" ? "Import complete" : "Import failed", json.status === "completed" ? "success" : "error");
    }
  }

  async function startImport() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("dedupeStrategy", dedupeStrategy);
      const res = await fetch("/api/admin/data-management/users/import", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        showToast("Upload failed", "error");
        return;
      }
      const { jobId, totalRows } = await res.json();
      setJob({ jobId, status: "pending", totalRows, processedRows: 0, importedCount: 0, skippedCount: 0, errorCount: 0 });
      pollRef.current = setInterval(() => void processNextBatch(jobId), 1500);
      void processNextBatch(jobId);
    } finally {
      setUploading(false);
    }
  }

  const pct = job && job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50">Import Users</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">✕</button>
        </div>

        {!job ? (
          <div className="space-y-3">
            <p className="text-xs text-neutral-500">
              Upload an NDJSON file (as produced by the Full Account Export) or a JSON array of user records. Max ~50MB.
            </p>
            <input
              type="file"
              accept=".ndjson,.json,text/plain,application/json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-neutral-700 dark:text-neutral-300"
            />
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">Dedupe strategy (matched by email/username/id)</label>
              <select
                value={dedupeStrategy}
                onChange={(e) => setDedupeStrategy(e.target.value as "skip" | "overwrite")}
                className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              >
                <option value="skip">Skip existing accounts</option>
                <option value="overwrite">Overwrite safe fields on existing accounts</option>
              </select>
            </div>
            <button
              onClick={() => void startImport()}
              disabled={!file || uploading}
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-600 px-3 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {uploading ? "Uploading…" : "Start Import"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-neutral-500">
              {job.processedRows.toLocaleString()} / {job.totalRows.toLocaleString()} rows processed ({pct}%)
            </p>
            {job.status === "completed" && (
              <div className="rounded-lg border border-success-200 bg-success-50 p-3 text-xs text-success-700 dark:border-success-800 dark:bg-success-950/30 dark:text-success-300">
                Imported: {job.importedCount} · Skipped: {job.skippedCount} · Errors: {job.errorCount}
              </div>
            )}
            {job.status !== "completed" && job.status !== "failed" && (
              <p className="text-xs text-neutral-400">Processing in batches — this can take a while for large files. Keep this dialog open.</p>
            )}
            <button onClick={onClose} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create user modal
// ---------------------------------------------------------------------------

function CreateUserModal({ onClose, onCreated, showToast }: { onClose: () => void; onCreated: () => void; showToast: (m: string, t?: "success" | "error") => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("free");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/data-management/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email: email || undefined,
          displayName: displayName || undefined,
          password: password || undefined,
          plan,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error?.message ?? "Could not create user", "error");
        return;
      }
      showToast("User created");
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50">Create User</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">✕</button>
        </div>
        <div className="space-y-2">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username *" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password (optional — otherwise OAuth-only)" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          <select value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
            <option value="free">Free</option>
            <option value="plus">Plus</option>
            <option value="pro">Pro</option>
            <option value="max">Max</option>
          </select>
          <button
            onClick={() => void submit()}
            disabled={submitting || username.length < 3}
            className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-600 px-3 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create User"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs content
// ---------------------------------------------------------------------------

function UsersTab() {
  const { data, cachedAt, isLive, loading, refreshing, refresh } = useStats("users");
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [tableKey, setTableKey] = useState(0);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <div>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-success-600" : "bg-danger-600"}`}>
          {toast.msg}
        </div>
      )}

      <StatsHeader cachedAt={cachedAt} isLive={isLive} refreshing={refreshing} onRefresh={refresh} />
      {loading ? (
        <StatCardSkeleton />
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Users" value={fmtNum(Number(data?.totalUsers ?? 0))} icon="👥" />
          <StatCard label="Verified" value={fmtNum(Number(data?.verifiedCount ?? 0))} icon="✅" />
          <StatCard label="Banned / Suspended" value={`${fmtNum(Number(data?.bannedCount ?? 0))} / ${fmtNum(Number(data?.suspendedCount ?? 0))}`} icon="🚫" />
          <StatCard label="Admins / Mods" value={fmtNum(Number(data?.adminOrModCount ?? 0))} icon="🛡️" />
          <StatCard label="New Today" value={fmtNum(Number(data?.newToday ?? 0))} icon="🆕" />
          <StatCard label="New This Week" value={fmtNum(Number(data?.newThisWeek ?? 0))} icon="📈" />
          <StatCard label="Avg Trust Score" value={String(data?.avgTrustScore ?? 0)} icon="⭐" />
          <StatCard label="Avg XP" value={fmtNum(Number(data?.avgXpTotal ?? 0))} icon="🎮" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setShowCreate(true)} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          + Create User
        </button>
        <button onClick={() => setShowExport(true)} className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
          Export
        </button>
        <button onClick={() => setShowImport(true)} className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
          Import
        </button>
      </div>

      <UserManagementTable key={tableKey} embedded onSelectionChange={setSelectedIds} />

      {showExport && <ExportModal selectedIds={selectedIds} onClose={() => setShowExport(false)} showToast={showToast} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} showToast={showToast} />}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => setTableKey((k) => k + 1)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function FinancialTab() {
  const { data, cachedAt, isLive, loading, refreshing, refresh } = useStats("financial");
  const coinEconomy = data?.coinEconomy as { totalCoinsInCirculation?: number; usersWithCoins?: number } | undefined;
  const payoutSummary = data?.payoutSummary as { awaitingApproval?: { count: number } } | undefined;

  return (
    <div>
      <StatsHeader cachedAt={cachedAt} isLive={isLive} refreshing={refreshing} onRefresh={refresh} />
      {loading ? (
        <StatCardSkeleton />
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Coins in Circulation" value={fmtNum(coinEconomy?.totalCoinsInCirculation ?? 0)} icon="🪙" />
          <StatCard label="Users with Coins" value={fmtNum(coinEconomy?.usersWithCoins ?? 0)} icon="👛" />
          <StatCard label="Payouts Awaiting Approval" value={fmtNum(payoutSummary?.awaitingApproval?.count ?? 0)} icon="⏳" />
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/gate44/financial" className="rounded-xl border border-neutral-300 px-4 py-2.5 font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
          Open Financial Dashboard →
        </Link>
        <Link href="/gate44/payouts" className="rounded-xl border border-neutral-300 px-4 py-2.5 font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
          Open Payouts Queue →
        </Link>
      </div>
    </div>
  );
}

function StatisticalTab() {
  const { data, cachedAt, isLive, loading, refreshing, refresh } = useStats("statistical");
  return (
    <div>
      <StatsHeader cachedAt={cachedAt} isLive={isLive} refreshing={refreshing} onRefresh={refresh} />
      {loading ? (
        <StatCardSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Rooms" value={fmtNum(Number(data?.totalRooms ?? 0))} icon="🏠" />
          <StatCard label="Room Messages" value={fmtNum(Number(data?.totalMessages ?? 0))} icon="💬" />
          <StatCard label="Guilds" value={fmtNum(Number(data?.totalGuilds ?? 0))} icon="🛡️" />
          <StatCard label="Forum Threads" value={fmtNum(Number(data?.totalForumThreads ?? 0))} icon="🧵" />
          <StatCard label="Forum Posts" value={fmtNum(Number(data?.totalForumPosts ?? 0))} icon="📝" />
          <StatCard label="Polls" value={fmtNum(Number(data?.totalPolls ?? 0))} icon="📊" />
          <StatCard label="Quizzes" value={fmtNum(Number(data?.totalQuizzes ?? 0))} icon="❓" />
          <StatCard label="Tweets" value={fmtNum(Number(data?.totalTweets ?? 0))} icon="🐦" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function DataManagementContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "financial" || tabParam === "statistical" ? tabParam : "users";

  function setTab(next: Tab) {
    router.push(`/gate44/data-management?tab=${next}`);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "users", label: t("admin.dataManagement.tabs.users", "Users") },
    { key: "financial", label: t("admin.dataManagement.tabs.financial", "Financial") },
    { key: "statistical", label: t("admin.dataManagement.tabs.statistical", "Statistical") },
  ];

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        {t("admin.dataManagement.title", "Data Management")}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        {t("admin.dataManagement.subtitle", "Search, export, import, and manage user accounts, plus platform-wide financial and statistical snapshots.")}
      </p>

      <div className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === tb.key
                ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "financial" && <FinancialTab />}
      {tab === "statistical" && <StatisticalTab />}
    </div>
  );
}

export default function DataManagementPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-neutral-500">Loading…</div>}>
      <DataManagementContent />
    </Suspense>
  );
}
