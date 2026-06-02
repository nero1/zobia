"use client";

/**
 * app/(admin)/admin/users/page.tsx
 *
 * Admin user management page.
 * Search users by username, email, or ID.
 * Click a row to open a detail panel with actions.
 */

import { useState, useCallback } from "react";
import type { Metadata } from "next";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Plan = "free" | "basic" | "pro" | "vip";
type UserStatus = "active" | "suspended" | "banned";
type SuspendDuration = "1h" | "24h" | "7d" | "30d";
type ActionType = "suspend" | "ban" | "restore" | "make_mod" | "revoke_mod";

interface AdminUser {
  id: string;
  username: string;
  email: string;
  avatarEmoji: string;
  plan: Plan;
  trustScore: number; // 0–100
  joinedAt: string;
  lastActiveAt: string;
  status: UserStatus;
  isModerator: boolean;
  reportHistoryCount: number;
  paymentHistoryCount: number;
  messageCount: number;
  roomsCreated: number;
  city: string;
}

interface UsersResponse {
  users: AdminUser[];
  total: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_BADGE: Record<Plan, { label: string; classes: string }> = {
  free: { label: "Free", classes: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" },
  basic: { label: "Basic", classes: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  pro: { label: "Pro", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" },
  vip: { label: "VIP", classes: "bg-gold-100 text-gold-700 dark:bg-gold-900 dark:text-gold-300" },
};

const STATUS_BADGE: Record<UserStatus, { label: string; classes: string }> = {
  active: { label: "Active", classes: "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300" },
  suspended: { label: "Suspended", classes: "bg-gold-100 text-gold-700 dark:bg-gold-900 dark:text-gold-300" },
  banned: { label: "Banned", classes: "bg-danger-100 text-danger-700 dark:bg-danger-900 dark:text-danger-300" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Trust score bar
// ---------------------------------------------------------------------------

function TrustBar({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-success-500" : score >= 40 ? "bg-gold-500" : "bg-danger-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums text-neutral-500">{score}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

interface DetailPanelProps {
  user: AdminUser;
  onClose: () => void;
  onAction: (userId: string, action: ActionType, payload?: Record<string, string>) => Promise<void>;
}

function DetailPanel({ user, onClose, onAction }: DetailPanelProps) {
  const [suspendDuration, setSuspendDuration] = useState<SuspendDuration>("24h");
  const [reason, setReason] = useState("");
  const [banType, setBanType] = useState<"temporary" | "permanent">("temporary");
  const [loading, setLoading] = useState<ActionType | null>(null);

  async function handleAction(action: ActionType) {
    setLoading(action);
    try {
      await onAction(user.id, action, { reason, duration: suspendDuration, banType });
    } finally {
      setLoading(null);
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col overflow-y-auto border-l border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900 sm:w-96">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">User Detail</h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 p-4">
        {/* Identity */}
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-3xl dark:bg-neutral-800">
            {user.avatarEmoji}
          </span>
          <div>
            <p className="font-semibold text-neutral-900 dark:text-neutral-50">@{user.username}</p>
            <p className="text-xs text-neutral-500">{user.email}</p>
            <p className="text-xs text-neutral-400">ID: {user.id}</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Plan", value: user.plan.toUpperCase() },
            { label: "Status", value: user.status },
            { label: "Trust Score", value: `${user.trustScore}/100` },
            { label: "City", value: user.city || "—" },
            { label: "Joined", value: formatDate(user.joinedAt) },
            { label: "Last Active", value: timeAgo(user.lastActiveAt) },
            { label: "Messages", value: user.messageCount.toLocaleString() },
            { label: "Rooms Created", value: user.roomsCreated.toString() },
            { label: "Reports", value: user.reportHistoryCount.toString() },
            { label: "Payments", value: user.paymentHistoryCount.toString() },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">{label}</p>
              <p className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">{value}</p>
            </div>
          ))}
        </div>

        {/* Suspend controls */}
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Suspend Options</p>
          <div className="flex flex-wrap gap-1.5">
            {(["1h", "24h", "7d", "30d"] as SuspendDuration[]).map((d) => (
              <button
                key={d}
                onClick={() => setSuspendDuration(d)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  suspendDuration === d
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-500">Ban type:</label>
            <select
              value={banType}
              onChange={(e) => setBanType(e.target.value as "temporary" | "permanent")}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              <option value="temporary">Temporary</option>
              <option value="permanent">Permanent</option>
            </select>
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required for suspend/ban)"
            rows={2}
            className="w-full resize-none rounded-lg border border-neutral-300 bg-white p-2 text-xs placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2">
          <ActionButton
            label={`Suspend ${suspendDuration}`}
            onClick={() => handleAction("suspend")}
            loading={loading === "suspend"}
            disabled={!reason}
            className="bg-gold-100 text-gold-800 hover:bg-gold-200 dark:bg-gold-900 dark:text-gold-200"
          />
          <ActionButton
            label="Ban"
            onClick={() => handleAction("ban")}
            loading={loading === "ban"}
            disabled={!reason}
            className="bg-danger-100 text-danger-700 hover:bg-danger-200 dark:bg-danger-900 dark:text-danger-300"
          />
          <ActionButton
            label="Restore"
            onClick={() => handleAction("restore")}
            loading={loading === "restore"}
            className="bg-success-100 text-success-700 hover:bg-success-200 dark:bg-success-900 dark:text-success-300"
          />
          <ActionButton
            label={user.isModerator ? "Revoke Mod" : "Make Mod"}
            onClick={() => handleAction(user.isModerator ? "revoke_mod" : "make_mod")}
            loading={loading === "make_mod" || loading === "revoke_mod"}
            className="bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300"
          />
        </div>
      </div>
    </aside>
  );
}

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

function ActionButton({ label, onClick, loading, disabled, className = "" }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${className}`}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        label
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin user management page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  async function search(pageNum = 1) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, page: String(pageNum), limit: "20" });
      const res = await fetch(`/api/admin/users?${params}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load users");
      const data = (await res.json()) as UsersResponse;
      setUsers(data.users);
      setTotal(data.total);
      setPage(pageNum);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(
    userId: string,
    action: ActionType,
    payload?: Record<string, string>
  ) {
    const res = await fetch(`/api/admin/users/${userId}/action`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      showToast("Action failed", "error");
      return;
    }
    showToast("Action applied successfully");
    // Refresh the user in list
    await search(page);
    setSelected(null);
  }

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">User Management</h1>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${
            toast.type === "success" ? "bg-success-600" : "bg-danger-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Search bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); search(1); }}
        className="mb-6 flex gap-3"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username, email, or ID…"
          className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              {["User", "Plan", "Trust", "Joined", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)
              : users.length === 0
              ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-neutral-500">
                    {query ? "No users found" : "Search to find users"}
                  </td>
                </tr>
              )
              : users.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setSelected(u)}
                  className="cursor-pointer transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{u.avatarEmoji}</span>
                      <div>
                        <p className="font-medium text-neutral-900 dark:text-neutral-100">@{u.username}</p>
                        <p className="text-xs text-neutral-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PLAN_BADGE[u.plan].classes}`}>
                      {PLAN_BADGE[u.plan].label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <TrustBar score={u.trustScore} />
                  </td>
                  <td className="px-4 py-3 text-neutral-500">{formatDate(u.joinedAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[u.status].classes}`}>
                      {STATUS_BADGE[u.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-blue-600 dark:text-blue-400">View →</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
          <span>{total} total users</span>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => search(page - 1)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40 hover:bg-neutral-50 dark:border-neutral-700"
            >
              ← Prev
            </button>
            <span className="flex items-center px-2">Page {page}</span>
            <button
              disabled={page * 20 >= total}
              onClick={() => search(page + 1)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40 hover:bg-neutral-50 dark:border-neutral-700"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setSelected(null)}
          />
          <DetailPanel
            user={selected}
            onClose={() => setSelected(null)}
            onAction={handleAction}
          />
        </>
      )}
    </div>
  );
}
