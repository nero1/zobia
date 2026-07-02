"use client";

/**
 * app/(admin)/admin/business/pages/page.tsx
 *
 * Admin panel: Business Pages moderation (PRD §17). Mirrors
 * app/(admin)/admin/business/page.tsx's table/filter/action pattern.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface AdminBusinessPage {
  id: string;
  business_account_id: string;
  slug: string;
  name: string;
  status: string;
  status_reason: string | null;
  view_count: number;
  post_count: number;
  created_at: string;
  business_name: string;
  owner_username: string;
}

type FilterStatus = "all" | "active" | "deactivated" | "suspended" | "banned";
type PageAction = "suspend" | "ban" | "deactivate" | "restore" | "delete";

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    deactivated: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    suspended: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    banned: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return map[status] ?? map.active;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export default function AdminBusinessPagesPage() {
  const [pages, setPages] = useState<AdminBusinessPage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [reasonModal, setReasonModal] = useState<{ id: string; action: PageAction } | null>(null);
  const [reason, setReason] = useState("");

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
      });
      const res = await fetch(`/api/admin/business/pages?${params}`);
      const json = await res.json();
      if (json.success) {
        setPages(json.data.pages);
        setTotal(json.data.total);
      }
    } catch {
      showToast("Failed to load business pages", false);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: PageAction, actionReason?: string) => {
    setActing(id);
    try {
      const res = await fetch("/api/admin/business/pages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason: actionReason }),
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Business Pages</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{total} pages total</p>
        </div>
        <Link href="/admin/business" className="text-sm text-neutral-500 hover:underline">← Business Accounts</Link>
      </div>

      {toast && (
        <div className={`fixed right-5 top-5 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.ok ? "bg-green-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900 w-fit">
        {(["all", "active", "deactivated", "suspended", "banned"] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
              statusFilter === s
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {loading ? (
          <div className="py-16 text-center text-sm text-neutral-400">Loading…</div>
        ) : pages.length === 0 ? (
          <div className="py-16 text-center text-sm text-neutral-400">No business pages found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/50">
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Page</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Business / Owner</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Stats</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Created</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-neutral-600 dark:text-neutral-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {pages.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                    <td className="px-4 py-3">
                      <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="font-semibold text-neutral-900 hover:underline dark:text-neutral-50">{p.name}</a>
                      <p className="text-xs text-neutral-400">/p/{p.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-neutral-700 dark:text-neutral-300">{p.business_name}</p>
                      <p className="text-xs text-neutral-400">@{p.owner_username}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      👁 {p.view_count.toLocaleString()} · 📝 {p.post_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">{fmtDate(p.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusBadge(p.status)}`}>{p.status}</span>
                      {p.status_reason && <p className="mt-0.5 text-xs text-neutral-400">{p.status_reason}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {p.status === "active" ? (
                          <>
                            <button
                              onClick={() => { setReasonModal({ id: p.id, action: "suspend" }); setReason(""); }}
                              disabled={acting === p.id}
                              className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"
                            >
                              Suspend
                            </button>
                            <button
                              onClick={() => { setReasonModal({ id: p.id, action: "ban" }); setReason(""); }}
                              disabled={acting === p.id}
                              className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                            >
                              Ban
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => doAction(p.id, "restore")}
                            disabled={acting === p.id}
                            className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
                          >
                            Restore
                          </button>
                        )}
                        <button
                          onClick={() => { setReasonModal({ id: p.id, action: "delete" }); setReason(""); }}
                          disabled={acting === p.id}
                          className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">Page {page} of {totalPages} · {total} pages</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-neutral-700">← Prev</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-neutral-700">Next →</button>
          </div>
        </div>
      )}

      {reasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
            <h2 className="mb-1 text-base font-bold capitalize text-neutral-900 dark:text-neutral-50">{reasonModal.action} Page</h2>
            <p className="mb-4 text-xs text-neutral-500">Optionally provide a reason shown to the business owner.</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              rows={3}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setReasonModal(null)} className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold dark:border-neutral-700">Cancel</button>
              <button
                onClick={() => { doAction(reasonModal.id, reasonModal.action, reason.trim() || undefined); setReasonModal(null); }}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
