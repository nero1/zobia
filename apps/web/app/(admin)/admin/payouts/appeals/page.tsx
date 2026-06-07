"use client";

/**
 * app/(admin)/admin/payouts/appeals/page.tsx
 *
 * Admin view of payout appeals submitted by creators.
 * Lists all appeals with pending status and allows approve / dismiss actions.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Appeal {
  id: string;
  creator: {
    id: string;
    username: string;
    email: string | null;
  };
  grossKobo: number;
  netKobo: number;
  payoutMethod: string;
  region: string;
  status: string;
  rejectionReason: string | null;
  appealReason: string | null;
  appealStatus: "pending" | "resolved" | "dismissed";
  appealSubmittedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function koboToNgn(kobo: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(kobo / 100);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Appeal row
// ---------------------------------------------------------------------------

interface AppealRowProps {
  appeal: Appeal;
  onApprove: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  busy: string | null;
}

function AppealRow({ appeal, onApprove, onDismiss, busy }: AppealRowProps) {
  const isBusy = busy === appeal.id;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-neutral-900 dark:text-neutral-100">
            @{appeal.creator.username}
          </p>
          {appeal.creator.email && (
            <p className="text-xs text-neutral-400">{appeal.creator.email}</p>
          )}
        </div>
        <div className="text-right">
          <p className="font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
            {koboToNgn(appeal.netKobo)}
          </p>
          <p className="text-xs text-neutral-400">gross {koboToNgn(appeal.grossKobo)}</p>
        </div>
      </div>

      {/* Meta */}
      <div className="mb-3 flex flex-wrap gap-2 text-xs text-neutral-500">
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">
          {appeal.payoutMethod.replace(/_/g, " ")}
        </span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">
          {appeal.region}
        </span>
        {appeal.appealSubmittedAt && (
          <span title={appeal.appealSubmittedAt}>
            Appeal submitted {timeAgo(appeal.appealSubmittedAt)}
          </span>
        )}
      </div>

      {/* Rejection reason */}
      {appeal.rejectionReason && (
        <div className="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          <p className="mb-0.5 font-semibold">Original rejection reason:</p>
          <p>{appeal.rejectionReason}</p>
        </div>
      )}

      {/* Appeal reason */}
      {appeal.appealReason && (
        <div className="mb-4 rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          <p className="mb-0.5 font-semibold">Creator's appeal reason:</p>
          <p>{appeal.appealReason}</p>
        </div>
      )}

      {/* Actions */}
      {isBusy ? (
        <div className="flex justify-center py-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-blue-600" />
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onDismiss(appeal.id)}
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Dismiss
          </button>
          <button
            onClick={() => onApprove(appeal.id)}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Approve Appeal
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PayoutAppealsPage() {
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchAppeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts?appealPending=true&limit=50&offset=0", {
        credentials: "include",
      });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load appeals");
      const data = await res.json() as { payouts: Appeal[]; total: number };
      setAppeals(data.payouts);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAppeals();
  }, [fetchAppeals]);

  async function handleAction(id: string, action: "approve" | "dismiss") {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/payouts/${id}/appeal`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? `Failed to ${action} appeal`
        );
      }
      showToast(`Appeal ${action === "approve" ? "approved" : "dismissed"}`);
      await fetchAppeals();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Payout Appeals
      </h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Review creator appeals for rejected payouts.
      </p>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Count */}
      {!loading && (
        <p className="mb-4 text-sm text-neutral-500">
          {total} pending appeal{total !== 1 ? "s" : ""}
        </p>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800"
            />
          ))}
        </div>
      ) : appeals.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-14 text-center text-sm text-neutral-500 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          No pending appeals.
        </div>
      ) : (
        <div className="space-y-4">
          {appeals.map((appeal) => (
            <AppealRow
              key={appeal.id}
              appeal={appeal}
              onApprove={(id) => handleAction(id, "approve")}
              onDismiss={(id) => handleAction(id, "dismiss")}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
