"use client";

/**
 * app/(admin)/admin/kyc/page.tsx
 *
 * Admin/mod panel: identity KYC review queue (Tiers 1-3). List + filters,
 * a detail drawer with document previews (short-lived signed URLs) and AI
 * confidence scores, one-click approve/reject, plus a Settings tab for the
 * admin-configurable cost, Tier 1 review mode, and price/revenue thresholds.
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueItem {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  tier: number;
  status: string;
  account_type: string;
  citizenship_country: string | null;
  review_mode: string;
  ai_name_match_score: string | null;
  ai_document_confidence: string | null;
  ai_escalated: boolean;
  submitted_at: string;
}

interface DocumentItem {
  id: string;
  docType: string;
  createdAt: string;
  signedUrl: string | null;
}

interface SubmissionDetail extends QueueItem {
  email: string;
  bvn_last4: string | null;
  paystack_verification_status: string | null;
  id_type: string | null;
  id_number: string | null;
  submitted_full_name: string | null;
  ai_provider: string | null;
  ai_notes: string | null;
  video_url: string | null;
  liveness_status: string | null;
  liveness_score: string | null;
  liveness_notes: string | null;
  reuse_previous_address: boolean | null;
  updated_address: Record<string, string> | null;
  physical_verification_scheduled_at: string | null;
  physical_verification_notes: string | null;
  rejection_reason: string | null;
  documents: DocumentItem[];
}

type TabKey = "queue" | "settings";
const STATUS_FILTERS = ["all", "pending", "ai_review", "manual_review", "approved", "rejected"] as const;

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    ai_review: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    manual_review: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    cancelled: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  };
  return map[status] ?? map.pending;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminKycPage() {
  const [tab, setTab] = useState<TabKey>("queue");
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Identity KYC</h1>
        <div className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
          {(["queue", "settings"] as TabKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === k ? "bg-primary text-primary-foreground" : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      {tab === "queue" ? (
        <Suspense fallback={<div className="py-16 text-center text-sm text-neutral-400">Loading…</div>}>
          <QueueTab />
        </Suspense>
      ) : (
        <SettingsTab />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue tab
// ---------------------------------------------------------------------------

function QueueTab() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const userIdFilter = searchParams.get("userId");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueDepth, setQueueDepth] = useState<{ status: string; count: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (userIdFilter) params.set("userId", userIdFilter);
      const res = await fetch(`/api/admin/kyc?${params.toString()}`, { credentials: "include" });
      const body = await res.json();
      if (res.ok) {
        setItems(body.data.submissions ?? []);
        setQueueDepth(body.data.queueDepth ?? []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [statusFilter, userIdFilter]);

  useEffect(() => { void load(); }, [load]);

  const pendingCount = queueDepth.reduce((sum, q) => sum + Number(q.count), 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === s ? "bg-primary text-primary-foreground" : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
        {userIdFilter && (
          <span className="flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            Filtered to one user
            <button
              type="button"
              onClick={() => router.push("/admin/kyc")}
              className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
              aria-label="Clear user filter"
            >
              ✕
            </button>
          </span>
        )}
        {pendingCount > 0 && (
          <span className="text-xs font-medium text-amber-500">{pendingCount} awaiting review</span>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {loading ? (
          <div className="py-16 text-center text-sm text-neutral-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-neutral-400">No submissions found</div>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400 dark:border-neutral-800">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Tier</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">AI Score</th>
                <th className="px-4 py-2">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">{item.display_name}</div>
                    <div className="text-xs text-neutral-400">@{item.username}</div>
                  </td>
                  <td className="px-4 py-2.5">Tier {item.tier}</td>
                  <td className="px-4 py-2.5 capitalize">{item.account_type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(item.status)}`}>
                      {item.status.replace("_", " ")}
                      {item.ai_escalated && " ⚠"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-500">
                    {item.ai_name_match_score !== null
                      ? `${Math.round(Number(item.ai_name_match_score) * 100)}% name / ${Math.round(Number(item.ai_document_confidence ?? 0) * 100)}% doc`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-500">{new Date(item.submitted_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && <DetailDrawer id={selectedId} onClose={() => setSelectedId(null)} onResolved={() => { setSelectedId(null); void load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function DetailDrawer({ id, onClose, onResolved }: { id: string; onClose: () => void; onResolved: () => void }) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/kyc/${id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((b) => setDetail(b.data))
      .catch(() => setError("Could not load submission"))
      .finally(() => setLoading(false));
  }, [id]);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/kyc/${id}/approve`, { method: "POST", credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Approve failed");
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejectReason.trim()) { setError("A rejection reason is required."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/kyc/${id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Reject failed");
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  }

  const canReview = detail && ["pending", "ai_review", "manual_review"].includes(detail.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Submission review</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">✕</button>
        </div>

        {loading || !detail ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : (
          <div className="space-y-5 text-sm">
            <div>
              <p className="font-semibold text-neutral-900 dark:text-neutral-100">{detail.display_name} (@{detail.username})</p>
              <p className="text-xs text-neutral-500">{detail.email}</p>
              <p className="mt-1 text-xs text-neutral-500 capitalize">{detail.account_type} · Tier {detail.tier} · {detail.review_mode} review</p>
            </div>

            {detail.tier === 1 && (
              <div className="space-y-1 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <p className="font-medium text-neutral-800 dark:text-neutral-200">Tier 1 — Identity</p>
                <p className="text-xs text-neutral-500">Citizenship: {detail.citizenship_country ?? "—"}</p>
                {detail.bvn_last4 && (
                  <p className="text-xs text-neutral-500">
                    BVN: •••{detail.bvn_last4} (
                    {detail.paystack_verification_status === "failed"
                      ? "Paystack contact failed — review manually"
                      : detail.paystack_verification_status ?? "not yet contacted"}
                    )
                  </p>
                )}
                {detail.id_type && <p className="text-xs text-neutral-500">ID type: {detail.id_type} — {detail.id_number ?? "—"}</p>}
                <p className="text-xs text-neutral-500">Submitted name: {detail.submitted_full_name ?? "—"}</p>
                {detail.ai_name_match_score !== null && (
                  <p className="text-xs text-neutral-500">
                    AI: {Math.round(Number(detail.ai_name_match_score) * 100)}% name match, {Math.round(Number(detail.ai_document_confidence ?? 0) * 100)}% document confidence ({detail.ai_provider ?? "—"})
                  </p>
                )}
                {detail.ai_notes && <p className="text-xs italic text-neutral-500">&quot;{detail.ai_notes}&quot;</p>}
              </div>
            )}

            {detail.tier === 2 && (
              <div className="space-y-1 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <p className="font-medium text-neutral-800 dark:text-neutral-200">Tier 2 — Video + Liveness</p>
                {detail.video_url && (
                  <a href={detail.video_url} target="_blank" rel="noreferrer" className="block text-xs text-blue-500 underline">
                    Watch statement video →
                  </a>
                )}
                <p className="text-xs text-neutral-500">Liveness heuristic: {detail.liveness_status ?? "pending"}{detail.liveness_score ? ` (${Math.round(Number(detail.liveness_score) * 100)}%)` : ""}</p>
                {detail.liveness_notes && <p className="text-xs italic text-neutral-500">&quot;{detail.liveness_notes}&quot;</p>}
              </div>
            )}

            {detail.tier === 3 && (
              <div className="space-y-1 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <p className="font-medium text-neutral-800 dark:text-neutral-200">Tier 3 — Physical KYC</p>
                <p className="text-xs text-neutral-500">
                  {detail.reuse_previous_address ? "Reusing previous address on file." : `Updated address: ${JSON.stringify(detail.updated_address)}`}
                </p>
                <p className="text-xs text-amber-500">Schedule and complete the physical check out-of-band, then approve/reject here.</p>
                <PhysicalCheckScheduler
                  submissionId={detail.id}
                  scheduledAt={detail.physical_verification_scheduled_at}
                  notes={detail.physical_verification_notes}
                  canEdit={!!canReview}
                  onSaved={(scheduledAt, notes) =>
                    setDetail((d) => (d ? { ...d, physical_verification_scheduled_at: scheduledAt, physical_verification_notes: notes } : d))
                  }
                />
              </div>
            )}

            {detail.documents.length > 0 && (
              <div>
                <p className="mb-2 font-medium text-neutral-800 dark:text-neutral-200">Documents</p>
                <div className="grid grid-cols-2 gap-2">
                  {detail.documents.map((doc) => (
                    <a
                      key={doc.id}
                      href={doc.signedUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-neutral-200 p-2 text-center text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                    >
                      📄 {doc.docType.replace(/_/g, " ")}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {detail.status === "rejected" && detail.rejection_reason && (
              <p className="text-xs text-red-500">Rejected: {detail.rejection_reason}</p>
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            {canReview && (
              <div className="space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                {!showReject ? (
                  <div className="flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() => void approve()}
                      className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      ✓ Approve
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setShowReject(true)}
                      className="flex-1 rounded-lg border border-red-600 px-3 py-2 text-sm font-semibold text-red-500 disabled:opacity-50"
                    >
                      ✕ Reject
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason shown to the user…"
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={() => void reject()} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                        Confirm reject
                      </button>
                      <button onClick={() => setShowReject(false)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier 3 physical-check scheduler
// ---------------------------------------------------------------------------

function toLocalDatetimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PhysicalCheckScheduler({
  submissionId,
  scheduledAt,
  notes,
  canEdit,
  onSaved,
}: {
  submissionId: string;
  scheduledAt: string | null;
  notes: string | null;
  canEdit: boolean;
  onSaved: (scheduledAt: string | null, notes: string | null) => void;
}) {
  const [localDatetime, setLocalDatetime] = useState(toLocalDatetimeInputValue(scheduledAt));
  const [localNotes, setLocalNotes] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const isoScheduledAt = localDatetime ? new Date(localDatetime).toISOString() : null;
      const res = await fetch(`/api/admin/kyc/${submissionId}/schedule`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: isoScheduledAt, notes: localNotes.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Save failed");
      onSaved(isoScheduledAt, localNotes.trim() || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit && !scheduledAt && !notes) return null;

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-neutral-50 p-2 dark:bg-neutral-800/50">
      {scheduledAt && (
        <p className="text-xs text-neutral-600 dark:text-neutral-300">
          Scheduled: {new Date(scheduledAt).toLocaleString()}
        </p>
      )}
      {notes && !canEdit && <p className="text-xs italic text-neutral-500">&quot;{notes}&quot;</p>}
      {canEdit && (
        <>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Physical check date/time
            <input
              type="datetime-local"
              value={localDatetime}
              onChange={(e) => setLocalDatetime(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Notes
            <textarea
              value={localNotes}
              onChange={(e) => setLocalNotes(e.target.value)}
              placeholder="e.g. location, contact person…"
              rows={2}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            disabled={saving}
            onClick={() => void save()}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab — thin wrapper over PUT /api/admin/config/[key]
// ---------------------------------------------------------------------------

const SETTINGS_FIELDS: { key: string; label: string; type: "number" | "select" | "text"; options?: string[]; hint?: string }[] = [
  { key: "kyc_cost_credits", label: "Verification cost (credits)", type: "number" },
  { key: "kyc_tier1_review_mode", label: "Tier 1 review mode", type: "select", options: ["ai", "manual"] },
  { key: "kyc_ai_auto_approve_threshold", label: "AI auto-approve threshold (0-1)", type: "text" },
  { key: "kyc_ai_escalate_below_threshold", label: "AI escalate-to-manual threshold (0-1)", type: "text" },
  { key: "kyc_badge_min_tier", label: "Min tier for blue checkmark", type: "number" },
  { key: "kyc_individual_tier2_threshold_kobo", label: "Individual: Tier 2 threshold (kobo)", type: "number" },
  { key: "kyc_individual_tier2_threshold_usd_cents", label: "Individual: Tier 2 threshold (USD cents)", type: "number" },
  { key: "kyc_individual_tier3_threshold_kobo", label: "Individual: Tier 3 threshold (kobo)", type: "number" },
  { key: "kyc_individual_tier3_threshold_usd_cents", label: "Individual: Tier 3 threshold (USD cents)", type: "number" },
  { key: "kyc_business_tier2_threshold_kobo", label: "Business: Tier 2 threshold (kobo)", type: "number" },
  { key: "kyc_business_tier2_threshold_usd_cents", label: "Business: Tier 2 threshold (USD cents)", type: "number" },
  { key: "kyc_business_tier3_threshold_kobo", label: "Business: Tier 3 threshold (kobo)", type: "number" },
  { key: "kyc_business_tier3_threshold_usd_cents", label: "Business: Tier 3 threshold (USD cents)", type: "number" },
];

function SettingsTab() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/config", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => {
        const map: Record<string, string> = {};
        for (const row of (b?.data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;
        setValues(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save(key: string) {
    setSavingKey(key);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: values[key] ?? "" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Save failed");
      setMsg(`Saved ${key}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="max-w-xl space-y-3">
      <p className="text-xs text-amber-500 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3">
        These fine-grained KYC settings live in x_manifest and are also visible (with generic controls) on the main
        <span className="mx-1 font-medium">Platform Configuration</span> page under &quot;Miscellaneous&quot;. This tab gives them
        proper labels and units.
      </p>
      {msg && <p className="text-xs text-neutral-500">{msg}</p>}
      {SETTINGS_FIELDS.map((f) => (
        <div key={f.key} className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex-1">
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">{f.label}</label>
            {f.type === "select" ? (
              <select
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              >
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              />
            )}
          </div>
          <button
            disabled={savingKey === f.key}
            onClick={() => void save(f.key)}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {savingKey === f.key ? "Saving…" : "Save"}
          </button>
        </div>
      ))}
    </div>
  );
}
