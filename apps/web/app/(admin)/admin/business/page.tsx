"use client";

/**
 * app/(admin)/admin/business/page.tsx
 *
 * Admin panel: Business Accounts management.
 * Lists all business accounts; supports verification approval/rejection
 * and account suspension/restoration.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BusinessAccount {
  id: string;
  user_id: string;
  username: string;
  email: string | null;
  business_name: string;
  business_type: string | null;
  tier: string;
  status: string;
  verification_status: string;
  verification_requested_at: string | null;
  verified: boolean;
  created_at: string;
}

type FilterVerification = "all" | "pending" | "verified" | "rejected" | "unverified";
type FilterTier = "all" | "starter" | "growth" | "enterprise";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tierBadge(tier: string) {
  const map: Record<string, string> = {
    starter: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    growth: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    enterprise: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  };
  return map[tier] ?? map.starter;
}

function verificationBadge(status: string) {
  const map: Record<string, string> = {
    unverified: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    verified: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return map[status] ?? map.unverified;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminBusinessPage() {
  const [businesses, setBusinesses] = useState<BusinessAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [verFilter, setVerFilter] = useState<FilterVerification>("all");
  const [tierFilter, setTierFilter] = useState<FilterTier>("all");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        ...(verFilter !== "all" ? { verification_status: verFilter } : {}),
        ...(tierFilter !== "all" ? { tier: tierFilter } : {}),
      });
      const res = await fetch(`/api/admin/business?${params}`);
      const json = await res.json();
      if (json.success) {
        setBusinesses(json.data.businesses);
        setTotal(json.data.total);
      }
    } catch {
      showToast("Failed to load business accounts", false);
    } finally {
      setLoading(false);
    }
  }, [page, verFilter, tierFilter]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (
    id: string,
    action: "verify" | "reject" | "suspend" | "restore",
    reason?: string
  ) => {
    setActing(id);
    try {
      const res = await fetch("/api/admin/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(`Action "${action}" applied`);
        load();
      } else {
        showToast(json.error?.message ?? "Action failed", false);
      }
    } catch {
      showToast("Request failed", false);
    } finally {
      setActing(null);
    }
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Business Accounts</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{total} accounts total</p>
        </div>
        <div className="flex gap-4 text-sm font-medium">
          <Link href="/admin/business/pages" className="text-neutral-600 hover:underline dark:text-neutral-400">Business Pages →</Link>
          <Link href="/admin/sponsored-quests" className="text-neutral-600 hover:underline dark:text-neutral-400">Ads Moderation (Sponsored Quests) →</Link>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-5 top-5 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.ok ? "bg-green-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
          {(["all", "pending", "verified", "rejected", "unverified"] as FilterVerification[]).map((v) => (
            <button
              key={v}
              onClick={() => { setVerFilter(v); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                verFilter === v
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
          {(["all", "starter", "growth", "enterprise"] as FilterTier[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTierFilter(t); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                tierFilter === t
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {loading ? (
          <div className="py-16 text-center text-sm text-neutral-400">Loading…</div>
        ) : businesses.length === 0 ? (
          <div className="py-16 text-center text-sm text-neutral-400">No business accounts found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/50">
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Business</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">User</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Tier</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Verification</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Requested</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {businesses.map((biz) => (
                  <tr key={biz.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-neutral-900 dark:text-neutral-50">{biz.business_name}</p>
                      {biz.business_type && (
                        <p className="text-xs text-neutral-400 capitalize">{biz.business_type}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-neutral-700 dark:text-neutral-300">@{biz.username}</p>
                      {biz.email && <p className="text-xs text-neutral-400">{biz.email}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${tierBadge(biz.tier)}`}>
                        {biz.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${verificationBadge(biz.verification_status)}`}>
                        {biz.verification_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {fmtDate(biz.verification_requested_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                        biz.status === "active"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      }`}>
                        {biz.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {biz.verification_status === "pending" && (
                          <>
                            <button
                              onClick={() => doAction(biz.id, "verify")}
                              disabled={acting === biz.id}
                              className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
                            >
                              Verify
                            </button>
                            <button
                              onClick={() => { setRejectModal({ id: biz.id }); setRejectReason(""); }}
                              disabled={acting === biz.id}
                              className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {biz.status === "active" ? (
                          <button
                            onClick={() => doAction(biz.id, "suspend")}
                            disabled={acting === biz.id}
                            className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            onClick={() => doAction(biz.id, "restore")}
                            disabled={acting === biz.id}
                            className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            Page {page} of {totalPages} · {total} accounts
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-neutral-700"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-neutral-700"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Reject reason modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
            <h2 className="mb-1 text-base font-bold text-neutral-900 dark:text-neutral-50">Reject Verification</h2>
            <p className="mb-4 text-xs text-neutral-500">Optionally provide a reason shown to the business owner.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={3}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setRejectModal(null)}
                className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold dark:border-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  doAction(rejectModal.id, "reject", rejectReason.trim() || undefined);
                  setRejectModal(null);
                }}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
