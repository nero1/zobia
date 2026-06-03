"use client";

/**
 * app/(admin)/admin/kyc/page.tsx
 *
 * Admin KYC review queue.
 * Shows pending KYC submissions with Approve / Reject actions.
 * Reject opens a modal for rejection reason.
 * Data from GET /api/admin/kyc.
 * Admin-only.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KycStatus = "pending" | "verified" | "rejected";

interface KycSubmission {
  id: string;
  creatorId: string;
  creatorUsername: string;
  creatorAvatarEmoji: string;
  fullName: string;
  bvnLast4: string;
  bankName: string;
  bankAccountNumber: string;
  bankCode: string;
  submittedAt: string;
  status: KycStatus;
}

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

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Reject modal
// ---------------------------------------------------------------------------

interface RejectModalProps {
  submission: KycSubmission;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  rejecting: boolean;
}

function RejectModal({ submission, onConfirm, onCancel, rejecting }: RejectModalProps) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-2 text-lg font-bold text-neutral-900 dark:text-neutral-50">Reject KYC</h3>
        <p className="mb-4 text-sm text-neutral-500">
          Rejecting KYC for <span className="font-semibold text-neutral-900 dark:text-neutral-100">@{submission.creatorUsername}</span>.
          Provide a reason so the creator can resubmit.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Enter rejection reason…"
          rows={3}
          required
          className="mb-4 w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={rejecting}
            className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
          >
            Cancel
          </button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim() || rejecting}
            className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {rejecting ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin KYC review queue.
 */
export default function AdminKycPage() {
  const [submissions, setSubmissions] = useState<KycSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<KycSubmission | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [tab, setTab] = useState<"pending" | "reviewed">("pending");

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/kyc?status=${tab}`, { credentials: "include" });
        if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
        if (!res.ok) throw new Error("Failed to load KYC queue");
        const data = (await res.json()) as { submissions: KycSubmission[] };
        setSubmissions(data.submissions);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [tab]);

  async function handleApprove(submission: KycSubmission) {
    setActioning(submission.id);
    try {
      const res = await fetch(`/api/admin/kyc/${submission.id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Approval failed");
      setSubmissions((prev) => prev.filter((s) => s.id !== submission.id));
      showToast(`@${submission.creatorUsername} KYC approved`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Approve failed", "error");
    } finally {
      setActioning(null);
    }
  }

  async function handleReject(reason: string) {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/admin/kyc/${rejectTarget.id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error("Rejection failed");
      setSubmissions((prev) => prev.filter((s) => s.id !== rejectTarget.id));
      showToast(`@${rejectTarget.creatorUsername} KYC rejected`);
      setRejectTarget(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Reject failed", "error");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">KYC Review Queue</h1>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Reject modal */}
      {rejectTarget && (
        <RejectModal
          submission={rejectTarget}
          onConfirm={handleReject}
          onCancel={() => setRejectTarget(null)}
          rejecting={rejecting}
        />
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {(["pending", "reviewed"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
              tab === key
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              <th className="px-4 py-3 text-left font-semibold">Creator</th>
              <th className="px-4 py-3 text-left font-semibold">Full Name</th>
              <th className="px-4 py-3 text-left font-semibold">Bank</th>
              <th className="px-4 py-3 text-left font-semibold">Account No.</th>
              <th className="px-4 py-3 text-left font-semibold">Submitted</th>
              <th className="px-4 py-3 text-center font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)
            ) : submissions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center text-neutral-500">
                  {tab === "pending" ? "No pending KYC submissions." : "No reviewed submissions."}
                </td>
              </tr>
            ) : (
              submissions.map((s) => {
                const isBusy = actioning === s.id;
                return (
                  <tr key={s.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    {/* Creator */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-lg dark:bg-neutral-800">
                          {s.creatorAvatarEmoji}
                        </span>
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">@{s.creatorUsername}</span>
                      </div>
                    </td>
                    {/* Full name */}
                    <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">{s.fullName}</td>
                    {/* Bank */}
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{s.bankName}</td>
                    {/* Account */}
                    <td className="px-4 py-3 font-mono text-xs text-neutral-700 dark:text-neutral-300">
                      {s.bankAccountNumber}
                    </td>
                    {/* Date */}
                    <td className="px-4 py-3 text-xs text-neutral-500">{formatDate(s.submittedAt)}</td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      {s.status === "pending" ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleApprove(s)}
                            disabled={isBusy}
                            className="rounded-lg bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300"
                          >
                            {isBusy ? "…" : "Approve"}
                          </button>
                          <button
                            onClick={() => setRejectTarget(s)}
                            disabled={isBusy}
                            className="rounded-lg bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                            s.status === "verified"
                              ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300"
                              : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                          }`}
                        >
                          {s.status}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
